import type { SettleResponse } from "@x402/core/types";
import {
  XGuardError,
  derivePaymentIdentities,
  parseJsonStrict,
  readHttpBodyTextCapped,
  sha256Hex,
} from "@xguard/core/edge";
import { verifyFinalizedBaseUsdcDeposit } from "./base-usdc.js";
import {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  type MainnetPrepareResult,
} from "./mainnet-coordinator.js";
import {
  BASE_MAINNET,
  BASE_USDC,
  parseMainnetFacilitatorRequest,
  xPaySettle,
  xPayVerify,
  type MainnetProtocolEnv,
  type ParsedMainnetRequest,
} from "./mainnet-protocol.js";
import { settlementTruthResponse } from "./mainnet-settlement-truth.js";
import {
  ensureZeroFrictionMerchant,
  recordZeroFrictionPayment,
  type ZeroFrictionAccount,
} from "./zero-friction-billing.js";

const MAX_JSON_BYTES = 64 * 1024;
const CLIENT_CONCURRENCY_LIMIT = 4;
const CLIENT_LEASE_MS = 45_000;
const XPAY_ID = "xpay-mainnet";
const TRUTH_PATH = /^\/v1\/settlements\/([0-9a-fA-F]{64})\/(truth|resolve)$/;

type TruthEnv = Parameters<typeof settlementTruthResponse>[1];

export interface ZeroFrictionEnv extends MainnetProtocolEnv {
  DB: D1Database;
  PAYMENT_COORDINATOR: DurableObjectNamespace<MainnetPaymentCoordinator>;
  REQUEST_GATE: DurableObjectNamespace<MainnetRequestGate>;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  BASE_RPC_URL: string;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  XGUARD_FEE_MICRO_USD: string;
  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;
  PAYMENT_IDENTIFIER_TTL_SECONDS: string;
  [key: string]: unknown;
}

type DelegateFetch = (request: Request) => Promise<Response>;

export async function zeroFrictionX402Response(
  request: Request,
  env: ZeroFrictionEnv,
  ctx: ExecutionContext,
  delegate: DelegateFetch,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "POST" && url.pathname === "/verify")
    return secure(await handleVerify(request, env));

  if (request.method === "POST" && url.pathname === "/settle")
    return secure(await handleSettle(request, env, ctx));

  if (request.method === "GET" && url.pathname === "/v1/fees")
    return secure(await feeBalance(request, env));

  if (request.method === "POST" && url.pathname === "/v1/fees/claim")
    return secure(await claimFeePayment(request, env));

  const truthMatch = url.pathname.match(TRUTH_PATH);
  if (truthMatch !== null) {
    const response = await publicSettlementTruth(
      request,
      env,
      truthMatch[1]!.toLowerCase(),
    );
    if (response !== null) return secure(response);
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/" || url.pathname === "/status")
  ) {
    const response = await delegate(request);
    return secure(await rewritePublicSurface(response, url.pathname, env));
  }

  if (request.method === "GET" && url.pathname === "/quickstart")
    return secure(quickstartResponse(url.origin, env));

  return null;
}

async function handleVerify(
  request: Request,
  env: ZeroFrictionEnv,
): Promise<Response> {
  try {
    validateRuntime(env);
    const parsed = await parseMainnetFacilitatorRequest(request);
    const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);
    const debtBlock = dueBlock(account, env);
    if (debtBlock !== null) return debtBlock;

    return withProtection(request, env, account.payTo, async () => {
      const result = await xPayVerify(env, parsed.raw, parsed.payer);
      return json(result, 200, feeHeaders(account, env, "not-charged"));
    });
  } catch (error) {
    return errorResponse(error);
  }
}

async function handleSettle(
  request: Request,
  env: ZeroFrictionEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  let network = BASE_MAINNET;
  try {
    validateRuntime(env);
    const parsed = await parseMainnetFacilitatorRequest(request);
    network = parsed.paymentRequirements.network;
    const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);
    const debtBlock = dueBlock(account, env);
    if (debtBlock !== null) return debtBlock;

    return withProtection(request, env, account.payTo, async () =>
      settleProtected(parsed, account, env, ctx),
    );
  } catch (error) {
    return json(
      settlementFailure(network, errorCode(error), publicErrorMessage(error)),
      errorStatus(error),
    );
  }
}

async function settleProtected(
  parsed: ParsedMainnetRequest,
  account: ZeroFrictionAccount,
  env: ZeroFrictionEnv,
  ctx: ExecutionContext,
): Promise<Response> {
  const identities = derivePaymentIdentities(
    parsed.paymentPayload,
    parsed.paymentRequirements,
  );
  await claimPaymentIdentifier(
    env,
    identities.paymentIdentifier,
    identities.logicalPaymentKey,
    identities.expiresAtSeconds,
  );

  const stub = env.PAYMENT_COORDINATOR.getByName(identities.logicalPaymentKey);
  const prepared = (await stub.prepare({
    logicalPaymentKey: identities.logicalPaymentKey,
    requestFingerprint: identities.requestFingerprint,
    merchantId: account.merchantId,
    network: parsed.paymentRequirements.network,
  })) as MainnetPrepareResult;

  if (prepared.kind === "CACHED")
    return json(prepared.result, 200, {
      ...feeHeaders(account, env, "already-accounted"),
      "X-XGuard-Replayed": "true",
      "X-XGuard-Payment-Key": identities.logicalPaymentKey,
    });

  if (prepared.kind === "FAILED")
    return json(
      prepared.result ??
        settlementFailure(
          parsed.paymentRequirements.network,
          "xguard_settlement_failed",
          "Previous settlement failed",
        ),
      200,
      { "X-XGuard-Replayed": "true" },
    );

  if (prepared.kind === "CONFLICT")
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_payment_conflict",
        "Authorization is bound to different terms",
      ),
      409,
    );

  if (prepared.kind === "AMBIGUOUS")
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_ambiguous",
        "Settlement outcome is uncertain; automatic retry is disabled",
      ),
      503,
      { "Retry-After": "5" },
    );

  if (prepared.kind === "IN_PROGRESS")
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_in_progress",
        "Settlement is already in progress",
      ),
      409,
      { "Retry-After": "1" },
    );

  if (!(await stub.start(XPAY_ID)))
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_state_conflict",
        "Settlement ownership changed before submission",
      ),
      409,
    );

  let result: SettleResponse;
  try {
    result = await xPaySettle(
      env,
      parsed.raw,
      parsed.paymentRequirements,
      parsed.payer,
    );
  } catch (error) {
    await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
    ctx.waitUntil(stub.flushOutbox());
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_ambiguous",
        "Submission started but the final outcome is not trustworthy; XGuard will not blindly resubmit",
      ),
      503,
      { "Retry-After": "5" },
    );
  }

  if (!result.success) {
    await stub.finalize(result, result.errorReason ?? "downstream_rejected");
    ctx.waitUntil(stub.flushOutbox());
    return json(result, 200, {
      ...feeHeaders(account, env, "not-charged"),
      "X-XGuard-Replayed": "false",
      "X-XGuard-Payment-Key": identities.logicalPaymentKey,
    });
  }

  const now = new Date().toISOString();
  try {
    await env.DB.prepare(
      `INSERT INTO settlement_finality_jobs(
        logical_payment_key,merchant_id,transaction_hash,network,asset,
        expected_payer,expected_pay_to,expected_amount_micro_usd,
        settle_result_json,state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?)
      ON CONFLICT(logical_payment_key) DO NOTHING`,
    )
      .bind(
        identities.logicalPaymentKey,
        account.merchantId,
        result.transaction.toLowerCase(),
        BASE_MAINNET,
        BASE_USDC.toLowerCase(),
        parsed.payer.toLowerCase(),
        parsed.payTo.toLowerCase(),
        parsed.amountMicroUsd,
        JSON.stringify(result),
        now,
        now,
      )
      .run();
  } catch (error) {
    await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
    ctx.waitUntil(stub.flushOutbox());
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_ambiguous",
        "Settlement was submitted but independent finality tracking could not be persisted",
      ),
      503,
    );
  }

  try {
    await stub.finalize(result);
  } catch (error) {
    await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
    ctx.waitUntil(stub.flushOutbox());
    return json(
      settlementFailure(
        parsed.paymentRequirements.network,
        "xguard_ambiguous",
        "Settlement was submitted but durable completion could not be recorded",
      ),
      503,
    );
  }

  ctx.waitUntil(stub.flushOutbox());
  return json(result, 200, {
    ...feeHeaders(account, env, "pending-finality"),
    "X-XGuard-Replayed": "false",
    "X-XGuard-Payment-Key": identities.logicalPaymentKey,
    "X-XGuard-Truth-State": "PENDING",
    "X-XGuard-Truth-Endpoint": `/v1/settlements/${identities.logicalPaymentKey}/truth`,
    "X-XGuard-Resolve-Endpoint": `/v1/settlements/${identities.logicalPaymentKey}/resolve`,
    "X-XGuard-Release-Safe": "false",
  });
}

async function feeBalance(
  request: Request,
  env: ZeroFrictionEnv,
): Promise<Response> {
  try {
    validateRuntime(env);
    const payTo = new URL(request.url).searchParams.get("payTo") ?? "";
    const account = await ensureZeroFrictionMerchant(env.DB, payTo);
    return json(feeBalanceBody(account, env));
  } catch (error) {
    return errorResponse(error);
  }
}

async function claimFeePayment(
  request: Request,
  env: ZeroFrictionEnv,
): Promise<Response> {
  try {
    validateRuntime(env);
    const body = await jsonBody(request);
    const payTo = typeof body.payTo === "string" ? body.payTo : "";
    const transactionHash =
      typeof body.transactionHash === "string" ? body.transactionHash : "";
    if (!/^0x[0-9a-fA-F]{64}$/.test(transactionHash))
      throw new XGuardError(
        "BAD_REQUEST",
        "transactionHash must be a 32-byte EVM transaction hash",
        400,
      );

    const account = await ensureZeroFrictionMerchant(env.DB, payTo);
    const deposit = await verifyFinalizedBaseUsdcDeposit({
      rpcUrl: env.BASE_RPC_URL,
      transactionHash,
      treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,
      usdcContractAddress: BASE_USDC,
    });
    if (deposit.sender.toLowerCase() !== account.payTo)
      throw new XGuardError(
        "PAYMENT_CONFLICT",
        "Fee payment must be sent from the same payTo address that uses XGuard",
        409,
      );
    const updated = await recordZeroFrictionPayment(
      env.DB,
      account.payTo,
      deposit,
    );
    return json({ credited: true, ...feeBalanceBody(updated, env) });
  } catch (error) {
    return errorResponse(error);
  }
}

async function publicSettlementTruth(
  request: Request,
  env: ZeroFrictionEnv,
  logicalPaymentKey: string,
): Promise<Response | null> {
  const row = await env.DB.prepare(
    `SELECT merchant_id FROM settlement_finality_jobs WHERE logical_payment_key=?
     UNION ALL
     SELECT merchant_id FROM settlement_recovery_jobs WHERE logical_payment_key=?
     LIMIT 1`,
  )
    .bind(logicalPaymentKey, logicalPaymentKey)
    .first<{ merchant_id: string }>()
    .catch(() => null);
  if (row === null || !row.merchant_id.startsWith("zf_")) return null;
  return settlementTruthResponse(
    request,
    env as unknown as TruthEnv,
    row.merchant_id,
  );
}

async function withProtection(
  request: Request,
  env: ZeroFrictionEnv,
  payTo: string,
  run: () => Promise<Response>,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const ip = request.headers.get("cf-connecting-ip") ?? "anonymous";
  const ipKey = sha256Hex(ip);
  try {
    const [client, global] = await Promise.all([
      env.REQUEST_RATE_LIMITER.limit({ key: `zf:${path}:${ipKey}` }),
      env.GLOBAL_RATE_LIMITER.limit({ key: `zf:${path}` }),
    ]);
    if (!client.success || !global.success)
      return json({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch {
    return json({ error: "protection_unavailable" }, 503);
  }

  const gate = env.REQUEST_GATE.getByName(`zf:${payTo}`);
  const leaseId = crypto.randomUUID();
  let acquired = false;
  try {
    acquired = await gate.acquire(
      leaseId,
      Date.now(),
      CLIENT_LEASE_MS,
      CLIENT_CONCURRENCY_LIMIT,
    );
    if (!acquired)
      return json({ error: "concurrency_limit_exceeded" }, 429, {
        "Retry-After": "1",
      });
    return await run();
  } finally {
    if (acquired) await gate.release(leaseId).catch(() => undefined);
  }
}

async function claimPaymentIdentifier(
  env: ZeroFrictionEnv,
  identifier: string | null,
  logicalKey: string,
  authorizationExpiry: bigint,
): Promise<void> {
  if (identifier === null) return;
  const now = Math.floor(Date.now() / 1_000);
  const ttl = boundedInteger(
    env.PAYMENT_IDENTIFIER_TTL_SECONDS,
    1,
    86_400,
    "PAYMENT_IDENTIFIER_TTL_SECONDS",
  );
  const expires = Number(
    authorizationExpiry < BigInt(now + ttl)
      ? authorizationExpiry
      : BigInt(now + ttl),
  );
  const [, selected] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_identifiers(
        identifier,logical_payment_key,expires_at_epoch,created_at
      ) VALUES(?,?,?,?)
      ON CONFLICT(identifier) DO UPDATE SET
        logical_payment_key=excluded.logical_payment_key,
        expires_at_epoch=excluded.expires_at_epoch,
        created_at=excluded.created_at
      WHERE payment_identifiers.expires_at_epoch < ?`,
    ).bind(identifier, logicalKey, expires, new Date().toISOString(), now),
    env.DB.prepare(
      "SELECT logical_payment_key FROM payment_identifiers WHERE identifier=?",
    ).bind(identifier),
  ]);
  const owner =
    selected === undefined
      ? undefined
      : (selected.results[0] as { logical_payment_key?: string } | undefined)
          ?.logical_payment_key;
  if (owner !== logicalKey)
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "Payment identifier is already bound to another active authorization",
      409,
    );
}

function dueBlock(
  account: ZeroFrictionAccount,
  env: ZeroFrictionEnv,
): Response | null {
  const limit = postpaidLimitMicroUsd(env);
  if (account.dueMicroUsd < limit) return null;
  return json(
    {
      error: "xguard_service_fee_due",
      message:
        "XGuard starts with no signup or prepayment. This payTo address has reached its postpaid service limit; settle the accrued fee to continue.",
      ...feeBalanceBody(account, env),
      claimEndpoint: "/v1/fees/claim",
      claimBody: {
        payTo: account.payTo,
        transactionHash: "0x...",
      },
    },
    402,
  );
}

function feeBalanceBody(account: ZeroFrictionAccount, env: ZeroFrictionEnv) {
  return {
    payTo: account.payTo,
    billingModel: "postpaid-after-finality",
    feePerFinalizedSettlementMicroUsd: feeMicroUsd(env),
    feePerFinalizedSettlementUsd: microUsdToUsd(feeMicroUsd(env)),
    accruedMicroUsd: account.accruedMicroUsd,
    paidMicroUsd: account.paidMicroUsd,
    dueMicroUsd: account.dueMicroUsd,
    creditMicroUsd: account.creditMicroUsd,
    postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),
    treasury: {
      network: BASE_MAINNET,
      asset: BASE_USDC,
      address: env.XGUARD_TREASURY_USDC_ADDRESS,
    },
  };
}

function feeHeaders(
  account: ZeroFrictionAccount,
  env: ZeroFrictionEnv,
  state: string,
): Record<string, string> {
  return {
    "X-XGuard-Auth": "none",
    "X-XGuard-Billing": "postpaid-after-finality",
    "X-XGuard-Fee-State": state,
    "X-XGuard-Fee-USD": microUsdToUsd(feeMicroUsd(env)),
    "X-XGuard-PayTo": account.payTo,
  };
}

async function rewritePublicSurface(
  response: Response,
  pathname: string,
  env: ZeroFrictionEnv,
): Promise<Response> {
  if (!response.ok) return response;
  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  if (contentType.includes("application/json")) {
    try {
      const body = (await response.clone().json()) as Record<string, unknown>;
      if (pathname === "/") {
        body.price = {
          amount: microUsdToUsd(feeMicroUsd(env)),
          currency: "USD",
          event: "finalized_successful_settlement",
          model: "zero_signup_postpaid",
          verify: "free",
          failedSettlement: "free",
          retry: "no additional fee",
        };
        body.onboarding = {
          signup: false,
          apiKey: false,
          prepay: false,
          integration: "Set facilitator URL to https://xguardgate.com",
        };
      } else {
        body.billing = {
          model: "zero_signup_postpaid",
          feeMicroUsd: feeMicroUsd(env),
          postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),
        };
      }
      return jsonFromResponse(response, body);
    } catch {
      return response;
    }
  }

  if (contentType.includes("text/html")) {
    const html = (await response.text())
      .replaceAll("$0.04", `$${microUsdToUsd(feeMicroUsd(env))}`)
      .replaceAll("prepaid", "postpaid")
      .replaceAll("API key required", "No API key required");
    const headers = new Headers(response.headers);
    headers.delete("content-length");
    headers.set("cache-control", "no-store");
    return new Response(html, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

function quickstartResponse(origin: string, env: ZeroFrictionEnv): Response {
  const fee = microUsdToUsd(feeMicroUsd(env));
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XGuard Quickstart</title></head><body><main style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.55"><h1>XGuard: change one URL</h1><p>No account. No API key. No prepaid balance.</p><pre><code>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</code></pre><p>Verify is free. Failed settlements are free. A fee of $${fee} is accrued only after XGuard independently confirms a successful finalized settlement on Base.</p><p>Fee status: <code>GET ${origin}/v1/fees?payTo=0x...</code></p><p>When the postpaid limit is reached, send native Base USDC from the same <code>payTo</code> address to the treasury returned by that endpoint, then claim the transaction once.</p></main></body></html>`;
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

async function jsonBody(request: Request): Promise<Record<string, unknown>> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  const parsed = parseJsonStrict(
    await readHttpBodyTextCapped(request, MAX_JSON_BYTES, "JSON request body"),
  );
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
    throw new XGuardError("BAD_REQUEST", "JSON body must be an object", 400);
  return parsed as Record<string, unknown>;
}

function validateRuntime(env: ZeroFrictionEnv): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.XGUARD_TREASURY_USDC_ADDRESS))
    throw new Error("invalid_treasury_address");
  const rpc = new URL(env.BASE_RPC_URL);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password)
    throw new Error("invalid_base_rpc_url");
  feeMicroUsd(env);
  postpaidLimitMicroUsd(env);
}

function feeMicroUsd(env: ZeroFrictionEnv): number {
  return boundedInteger(
    env.XGUARD_FEE_MICRO_USD,
    1,
    1_000_000,
    "XGUARD_FEE_MICRO_USD",
  );
}

function postpaidLimitMicroUsd(env: ZeroFrictionEnv): number {
  return boundedInteger(
    env.XGUARD_POSTPAID_LIMIT_MICRO_USD ?? "1000000",
    1,
    1_000_000_000,
    "XGUARD_POSTPAID_LIMIT_MICRO_USD",
  );
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  field: string,
): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${field}_invalid`);
  return parsed;
}

function microUsdToUsd(value: number): string {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction}`;
}

function settlementFailure(
  network: string,
  reason: string,
  message: string,
): SettleResponse {
  return {
    success: false,
    transaction: "",
    network,
    errorReason: reason,
    errorMessage: message,
  } as SettleResponse;
}

function errorResponse(error: unknown): Response {
  return json(
    { error: errorCode(error), message: publicErrorMessage(error) },
    errorStatus(error),
  );
}

function errorCode(error: unknown): string {
  if (error instanceof XGuardError) return error.code.toLowerCase();
  if (error instanceof Error)
    return error.name === "AbortError"
      ? "upstream_timeout"
      : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return "unknown_error";
}

function publicErrorMessage(error: unknown): string {
  if (error instanceof XGuardError) return error.message;
  if (error instanceof Error && error.name === "AbortError")
    return "Upstream facilitator timed out";
  return "XGuard could not safely complete the request";
}

function errorStatus(
  error: unknown,
): 400 | 401 | 402 | 409 | 415 | 429 | 500 | 503 {
  if (error instanceof XGuardError) {
    const status = error.status;
    if ([400, 401, 402, 409, 415, 429, 500, 503].includes(status))
      return status as 400 | 401 | 402 | 409 | 415 | 429 | 500 | 503;
  }
  if (error instanceof Error && error.name === "AbortError") return 503;
  return 500;
}

function json(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function jsonFromResponse(response: Response, value: unknown): Response {
  const headers = new Headers(response.headers);
  headers.set("Content-Type", "application/json; charset=utf-8");
  headers.set("Cache-Control", "no-store");
  headers.delete("Content-Length");
  return new Response(JSON.stringify(value), {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

function secure(response: Response): Response {
  const headers = new Headers(response.headers);
  headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains",
  );
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("X-Frame-Options", "DENY");
  headers.set("Referrer-Policy", "no-referrer");
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
