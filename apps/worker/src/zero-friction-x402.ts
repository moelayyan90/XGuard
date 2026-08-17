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
  XGUARD_PRICING_VERSION?: string;
  XGUARD_FEE_BPS?: string;
  XGUARD_FEE_CAP_MICRO_USD?: string;
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
    return withProtection(request, env, parsed.payTo, async () => {
      const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);
      const debtBlock = dueBlock(account, env);
      if (debtBlock !== null) return debtBlock;
      const result = await xPayVerify(env, parsed.raw, parsed.payer);
      return json(result, 200, feeHeaders(account, "not-charged"));
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
    return withProtection(request, env, parsed.payTo, async () => {
      const account = await ensureZeroFrictionMerchant(env.DB, parsed.payTo);
      const debtBlock = dueBlock(account, env);
      if (debtBlock !== null) return debtBlock;
      return settleProtected(parsed, account, env, ctx);
    });
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
      ...feeHeaders(account, "already-accounted"),
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
      ...feeHeaders(account, "not-charged"),
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
    ...feeHeaders(account, "pending-finality"),
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
    return withProtection(request, env, payTo, async () => {
      const account = await ensureZeroFrictionMerchant(env.DB, payTo);
      return json(feeBalanceBody(account, env));
    });
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

    return withProtection(request, env, payTo, async () => {
      const account = await ensureZeroFrictionMerchant(env.DB, payTo);
      const deposit = await verifyFinalizedBaseUsdcDeposit({
        rpcUrl: env.BASE_RPC_URL,
        transactionHash,
        treasuryAddress: env.XGUARD_TREASURY_USDC_ADDRESS,
        usdcContractAddress: BASE_USDC,
      });
      const updated = await recordZeroFrictionPayment(
        env.DB,
        account.payTo,
        deposit,
      );
      return json({ credited: true, ...feeBalanceBody(updated, env) });
    });
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
  const limit = account.postpaidLimitMicroUsd;
  if (account.dueMicroUsd < limit) return null;
  return json(
    {
      error: "xguard_service_fee_due",
      message:
        "This activated payTo address has reached its signed postpaid XGuard service limit; settle the accrued service fee to continue.",
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

function feeBalanceBody(
  account: ZeroFrictionAccount,
  env: ZeroFrictionEnv,
) {
  return {
    payTo: account.payTo,
    billingModel: "postpaid_capped_revenue_share",
    pricingVersion: account.pricingVersion,
    feeBps: account.feeBps,
    feePercent: `${account.feeBps / 100}%`,
    feeCapMicroUsd: account.feeCapMicroUsd,
    feeCapUsd: microUsdToUsd(account.feeCapMicroUsd),
    accruedMicroUsd: account.accruedMicroUsd,
    paidMicroUsd: account.paidMicroUsd,
    dueMicroUsd: account.dueMicroUsd,
    creditMicroUsd: account.creditMicroUsd,
    postpaidLimitMicroUsd: account.postpaidLimitMicroUsd,
    postpaidLimitUsd: microUsdToUsd(account.postpaidLimitMicroUsd),
    treasury: {
      network: BASE_MAINNET,
      asset: BASE_USDC,
      address: env.XGUARD_TREASURY_USDC_ADDRESS,
    },
  };
}

function feeHeaders(
  account: ZeroFrictionAccount,
  state: string,
): Record<string, string> {
  return {
    "X-XGuard-Auth": "none-after-one-time-wallet-activation",
    "X-XGuard-Billing": "postpaid-capped-revenue-share",
    "X-XGuard-Fee-State": state,
    "X-XGuard-Pricing-Version": account.pricingVersion,
    "X-XGuard-Fee-Bps": String(account.feeBps),
    "X-XGuard-Fee-Cap-USD": microUsdToUsd(account.feeCapMicroUsd),
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
          pricingVersion: pricingVersion(env),
          model: "postpaid_capped_revenue_share",
          feeBps: feeBps(env),
          feePercent: `${feeBps(env) / 100}%`,
          feeCapMicroUsd: feeCapMicroUsd(env),
          feeCapUsd: microUsdToUsd(feeCapMicroUsd(env)),
          currency: "USD",
          event: "independently_finalized_successful_settlement",
          verify: "free",
          failedSettlement: "free",
          retry: "no additional fee",
        };
        body.onboarding = {
          account: false,
          email: false,
          password: false,
          apiKey: false,
          prepay: false,
          walletActivation: "one_signature",
          activation: "https://xguardgate.com/start",
          integration:
            "Activate payTo once, then set facilitator URL to https://xguardgate.com",
        };
      } else {
        body.billing = {
          pricingVersion: pricingVersion(env),
          model: "postpaid_capped_revenue_share",
          feeBps: feeBps(env),
          feeCapMicroUsd: feeCapMicroUsd(env),
          postpaidLimitMicroUsd: postpaidLimitMicroUsd(env),
          activation: "/start",
        };
      }
      return jsonFromResponse(response, body);
    } catch {
      return response;
    }
  }

  if (contentType.includes("text/html")) {
    const html = (await response.text())
      .replaceAll("$0.04", `up to $${microUsdToUsd(feeCapMicroUsd(env))}`)
      .replaceAll("$0.002", `up to $${microUsdToUsd(feeCapMicroUsd(env))}`)
      .replaceAll("prepaid", "postpaid")
      .replaceAll(
        "API key required",
        "No API key required after one wallet signature",
      );
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
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>XGuard Quickstart</title></head><body><main style="font-family:system-ui;max-width:760px;margin:48px auto;padding:0 20px;line-height:1.55"><h1>XGuard: activate once, then change one URL</h1><p>No account. No email. No password. No API key. No prepaid balance.</p><p><a href="${origin}/start">Connect the merchant payTo wallet and sign once</a> to accept ${feeBps(env) / 100}% of independently finalized successful settlements, capped at $${microUsdToUsd(feeCapMicroUsd(env))} per settlement.</p><pre><code>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</code></pre><p>Verify, failed settlements and idempotent retries add no fee.</p><p>Fee status: <code>GET ${origin}/v1/fees?payTo=0x...</code></p></main></body></html>`;
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
  pricingVersion(env);
  feeBps(env);
  feeCapMicroUsd(env);
  postpaidLimitMicroUsd(env);
}

function pricingVersion(env: ZeroFrictionEnv): string {
  const value = env.XGUARD_PRICING_VERSION ?? "2026-08-zero-friction-v1";
  if (!/^[a-z0-9._-]{1,64}$/i.test(value))
    throw new Error("XGUARD_PRICING_VERSION_invalid");
  return value;
}

function feeBps(env: ZeroFrictionEnv): number {
  return boundedInteger(
    env.XGUARD_FEE_BPS ?? "50",
    0,
    10_000,
    "XGUARD_FEE_BPS",
  );
}

function feeCapMicroUsd(env: ZeroFrictionEnv): number {
  return boundedInteger(
    env.XGUARD_FEE_CAP_MICRO_USD ?? "1000",
    0,
    1_000_000_000,
    "XGUARD_FEE_CAP_MICRO_USD",
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
  if (
    error instanceof Error &&
    error.message === "zero_friction_activation_required"
  )
    return "Activate this merchant payTo once at https://xguardgate.com/start. No account, email, API key, or prepayment is required.";
  if (error instanceof Error && error.name === "AbortError")
    return "Upstream facilitator timed out";
  return "XGuard could not safely complete the request";
}

function errorStatus(
  error: unknown,
): 400 | 401 | 402 | 403 | 409 | 415 | 429 | 500 | 503 {
  if (
    error instanceof Error &&
    error.message === "zero_friction_activation_required"
  )
    return 403;
  if (error instanceof XGuardError) {
    const status = error.status;
    if ([400, 401, 402, 403, 409, 415, 429, 500, 503].includes(status))
      return status as 400 | 401 | 402 | 403 | 409 | 415 | 429 | 500 | 503;
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
