import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { SettleResponse, SupportedResponse } from "@x402/core/types";
import {
  XGuardError,
  derivePaymentIdentities,
  parseJsonStrict,
  readHttpBodyTextCapped,
  sha256Hex,
} from "@xguard/core/edge";
import {
  authenticateMerchant,
  claimTopUp,
  createTopUpIntent,
  earnSettlementFee,
  merchantBalance,
  registerMerchant,
  releaseSettlementFee,
  reserveSettlementFee,
  type MerchantIdentity,
} from "./mainnet-billing.js";
import { verifyFinalizedBaseUsdcDeposit } from "./base-usdc.js";
import { verifyFinalizedBaseUsdcSettlement } from "./base-settlement.js";
import {
  BASE_MAINNET,
  BASE_USDC,
  fetchPayAISupported,
  parseMainnetFacilitatorRequest,
  payAISettle,
  payAIVerify,
  type MainnetProtocolEnv,
  type ParsedMainnetRequest,
} from "./mainnet-protocol.js";
import {
  MainnetPaymentCoordinator,
  MainnetRequestGate,
  type MainnetPrepareResult,
} from "./mainnet-coordinator.js";
import {
  deriveMainnetEconomicShadowBinding,
  parseMainnetEconomicShadowMode,
} from "./mainnet-economic-shadow.js";
import {
  mainnetEconomicShadowStats,
  pruneMainnetEconomicShadowTelemetry,
  recordMainnetEconomicShadowObservation,
} from "./mainnet-economic-shadow-telemetry.js";
import {
  evaluateMainnetEconomicSettlementAudit,
  mainnetEconomicAuditStats,
  parseMainnetEconomicAuditMode,
  recordMainnetEconomicAuditDecision,
} from "./mainnet-economic-audit.js";

export { MainnetPaymentCoordinator, MainnetRequestGate };

const PAYAI_ID = "payai-mainnet";
const MAX_JSON_BYTES = 64 * 1024;
const CLIENT_CONCURRENCY_LIMIT = 4;
const CLIENT_LEASE_MS = 45_000;
const FINALITY_BATCH_SIZE = 20;

interface MainnetEnv extends MainnetProtocolEnv {
  DB: D1Database;
  PAYMENT_COORDINATOR: DurableObjectNamespace<MainnetPaymentCoordinator>;
  REQUEST_GATE: DurableObjectNamespace<MainnetRequestGate>;
  REQUEST_RATE_LIMITER: RateLimit;
  GLOBAL_RATE_LIMITER: RateLimit;
  XGUARD_TREASURY_USDC_ADDRESS: string;
  BASE_RPC_URL: string;
  XGUARD_FEE_MICRO_USD: string;
  PAYMENT_IDENTIFIER_TTL_SECONDS: string;
  HEALTH_MAX_AGE_SECONDS: string;
  PAYAI_DOWNSTREAM_COST_MICRO_USD: string;
  ECONOMIC_FIREWALL_SHADOW_MODE?: string;
  ECONOMIC_FIREWALL_AUDIT_MODE?: string;
}

type Variables = { requestId: string };
type AppContext = Context<{ Bindings: MainnetEnv; Variables: Variables }>;

interface FinalityJob {
  logical_payment_key: string;
  merchant_id: string;
  transaction_hash: string;
  network: string;
  asset: string;
  expected_payer: string;
  expected_pay_to: string;
  expected_amount_micro_usd: number;
  settle_result_json: string;
  attempts: number;
}

const app = new Hono<{ Bindings: MainnetEnv; Variables: Variables }>();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  const started = performance.now();
  await next();
  context.header("X-Request-ID", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header(
    "Cache-Control",
    context.req.method === "GET" ? "public, max-age=15" : "no-store",
  );
  console.log(
    JSON.stringify({
      event: "request_complete",
      requestId,
      path: context.req.path,
      method: context.req.method,
      status: context.res.status,
      latencyMs: Math.round(performance.now() - started),
    }),
  );
});

app.use("/verify", abuseProtection);
app.use("/settle", abuseProtection);
app.use("/v1/*", abuseProtection);

app.get("/", (context) =>
  context.json({
    name: "XGuard",
    version: "0.2.0-mainnet-rc",
    protocol: "x402-v2",
    mode: "mainnet",
    network: BASE_MAINNET,
    asset: BASE_USDC,
    price: {
      amount: "0.002",
      currency: "USD",
      event: "successful_billable_settlement",
      model: "merchant_prepaid_service_balance",
    },
    endpoints: {
      register: "/v1/register",
      balance: "/v1/balance",
      topUpIntent: "/v1/topups/intents",
      topUpClaim: "/v1/topups/claim",
      supported: "/supported",
      verify: "/verify",
      settle: "/settle",
      status: "/status",
    },
  }),
);

app.get("/healthz", (context) =>
  context.json({ status: "ok", mode: "mainnet", network: BASE_MAINNET }),
);

app.get("/readyz", async (context) => {
  try {
    assertRuntimeConfig(context.env);
    await context.env.DB.prepare("SELECT 1 AS ready").first();
    const health = await currentPayAIHealth(context.env);
    const ready = health !== null && health.state === "HEALTHY";
    return context.json(
      {
        status: ready ? "ready" : "not_ready",
        mainnet: true,
        facilitator: ready ? "operational" : "degraded",
      },
      ready ? 200 : 503,
    );
  } catch {
    return context.json({ status: "not_ready", mainnet: true }, 503);
  }
});

app.get("/supported", async (context) => {
  const health = await currentPayAIHealth(context.env);
  if (health === null || health.state === "OPEN")
    return context.json({ kinds: [], extensions: [], signers: {} });
  try {
    const upstream = JSON.parse(health.capabilities_json) as SupportedResponse;
    return context.json({
      kinds: upstream.kinds.filter(
        (kind) =>
          kind.x402Version === 2 &&
          kind.network === BASE_MAINNET &&
          kind.scheme === "exact",
      ),
      extensions: upstream.extensions,
      signers: upstream.signers,
    });
  } catch {
    return context.json({ kinds: [], extensions: [], signers: {} });
  }
});

app.get("/status", async (context) => {
  const health = await currentPayAIHealth(context.env);
  const pending = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM settlement_finality_jobs WHERE state='PENDING'",
  ).first<{ count: number }>();
  const reconciliation = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reconciliation_cases WHERE state='OPEN'",
  ).first<{ count: number }>();
  const earned = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count,COALESCE(SUM(fee_micro_usd),0) AS total FROM usage_events",
  ).first<{ count: number; total: number }>();
  const shadowTelemetry = await mainnetEconomicShadowStats(
    context.env.DB,
  ).catch((error) => {
    console.warn(
      JSON.stringify({
        event: "economic_firewall_shadow_telemetry_read_failed",
        code: errorCode(error),
      }),
    );
    return null;
  });
  const auditTelemetry = await mainnetEconomicAuditStats(context.env.DB).catch(
    (error) => {
      console.warn(
        JSON.stringify({
          event: "economic_firewall_audit_telemetry_read_failed",
          code: errorCode(error),
        }),
      );
      return null;
    },
  );
  return context.json({
    gateway: "operational",
    mode: "mainnet",
    network: BASE_MAINNET,
    facilitator: health?.state ?? "UNKNOWN",
    pendingFinality: pending?.count ?? 0,
    openReconciliationCases: reconciliation?.count ?? 0,
    successfulBillableSettlements: earned?.count ?? 0,
    earnedMicroUsd: earned?.total ?? 0,
    economicFirewallShadow: {
      mode: parseMainnetEconomicShadowMode(
        context.env.ECONOMIC_FIREWALL_SHADOW_MODE,
      ),
      telemetry: shadowTelemetry === null ? "unavailable" : "operational",
      ...(shadowTelemetry ?? {
        intents: 0,
        verifyEvents: 0,
        settleEvents: 0,
        correlatedIntents: 0,
        settleWithoutVerifyIntents: 0,
        authorizationMismatchEvents: 0,
      }),
    },
    economicFirewallAudit: {
      mode: parseMainnetEconomicAuditMode(
        context.env.ECONOMIC_FIREWALL_AUDIT_MODE,
      ),
      telemetry: auditTelemetry === null ? "unavailable" : "operational",
      ...(auditTelemetry ?? {
        evaluatedSettles: 0,
        pass: 0,
        review: 0,
        correlatedAuthorization: 0,
        verifyNotObserved: 0,
        authorizationMismatch: 0,
      }),
    },
    measuredAt: new Date().toISOString(),
  });
});

app.post("/v1/register", async (context) => {
  try {
    assertRuntimeConfig(context.env);
    const body = await jsonBody(context.req.raw);
    const name = typeof body.name === "string" ? body.name : "";
    const result = await registerMerchant(context.env.DB, name);
    return context.json(
      {
        merchant: result.merchant,
        apiKey: result.apiKey,
        warning: "Store this API key now. XGuard stores only its hash.",
        treasury: {
          network: BASE_MAINNET,
          asset: BASE_USDC,
          address: context.env.XGUARD_TREASURY_USDC_ADDRESS,
        },
      },
      201,
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

app.get("/v1/balance", async (context) => {
  try {
    const merchant = await requireMerchant(context);
    return context.json(
      await merchantBalance(context.env.DB, merchant.merchantId),
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/topups/intents", async (context) => {
  try {
    assertRuntimeConfig(context.env);
    const merchant = await requireMerchant(context);
    const body = await jsonBody(context.req.raw);
    const amountMicroUsd = parseUsdToMicro(body.amountUsd);
    const intent = await createTopUpIntent(
      context.env.DB,
      merchant.merchantId,
      amountMicroUsd,
    );
    return context.json(
      {
        intentId: intent.intentId,
        claimToken: intent.claimToken,
        requestedMicroUsd: amountMicroUsd,
        exactDepositMicroUsd: intent.amountMicroUsd,
        exactDepositUsdc: microUsdToUsd(intent.amountMicroUsd),
        expiresAtEpoch: intent.expiresAtEpoch,
        network: BASE_MAINNET,
        asset: BASE_USDC,
        treasuryAddress: context.env.XGUARD_TREASURY_USDC_ADDRESS,
        instruction:
          "Send exactly exactDepositUsdc native USDC on Base, then claim using claimToken and the transaction hash.",
      },
      201,
    );
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/v1/topups/claim", async (context) => {
  try {
    assertRuntimeConfig(context.env);
    const merchant = await requireMerchant(context);
    const body = await jsonBody(context.req.raw);
    if (
      typeof body.claimToken !== "string" ||
      typeof body.transactionHash !== "string"
    )
      throw new XGuardError(
        "BAD_REQUEST",
        "claimToken and transactionHash are required",
        400,
      );
    const deposit = await verifyFinalizedBaseUsdcDeposit({
      rpcUrl: context.env.BASE_RPC_URL,
      transactionHash: body.transactionHash,
      treasuryAddress: context.env.XGUARD_TREASURY_USDC_ADDRESS,
      usdcContractAddress: BASE_USDC,
    });
    const balance = await claimTopUp(context.env.DB, {
      merchantId: merchant.merchantId,
      claimToken: body.claimToken,
      deposit,
      network: BASE_MAINNET,
      asset: BASE_USDC,
    });
    return context.json({ credited: true, balance });
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/verify", async (context) => {
  try {
    assertRuntimeConfig(context.env);
    const merchant = await requireMerchant(context);
    await requireHealthyPayAI(context.env);
    const body = await parseMainnetFacilitatorRequest(context.req.raw);
    observeEconomicFirewallShadow(context, merchant, body, "verify");
    const result = await payAIVerify(context.env, body.raw, body.payer);
    return context.json(result);
  } catch (error) {
    return errorJson(context, error);
  }
});

app.post("/settle", async (context) => {
  let network = BASE_MAINNET;
  try {
    assertRuntimeConfig(context.env);
    const merchant = await requireMerchant(context);
    await requireHealthyPayAI(context.env);
    const body = await parseMainnetFacilitatorRequest(context.req.raw);
    network = body.paymentRequirements.network;
    observeEconomicFirewallShadow(context, merchant, body, "settle");
    const identities = derivePaymentIdentities(
      body.paymentPayload,
      body.paymentRequirements,
    );
    await claimPaymentIdentifier(
      context.env,
      identities.paymentIdentifier,
      identities.logicalPaymentKey,
      identities.expiresAtSeconds,
    );

    const stub = context.env.PAYMENT_COORDINATOR.getByName(
      identities.logicalPaymentKey,
    );
    const prepared = (await stub.prepare({
      logicalPaymentKey: identities.logicalPaymentKey,
      requestFingerprint: identities.requestFingerprint,
      merchantId: merchant.merchantId,
      network,
    })) as MainnetPrepareResult;
    if (prepared.kind === "CACHED")
      return context.json(prepared.result, 200, {
        "X-XGuard-Replayed": "true",
        "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      });
    if (prepared.kind === "FAILED")
      return context.json(
        prepared.result ??
          failure(
            network,
            "xguard_settlement_failed",
            "Previous settlement failed",
          ),
        200,
        { "X-XGuard-Replayed": "true" },
      );
    if (prepared.kind === "CONFLICT")
      return context.json(
        failure(
          network,
          "xguard_payment_conflict",
          "Authorization is bound to different terms",
        ),
        409,
      );
    if (prepared.kind === "AMBIGUOUS")
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement outcome is uncertain; automatic retry is disabled",
        ),
        503,
      );
    if (prepared.kind === "IN_PROGRESS")
      return context.json(
        failure(
          network,
          "xguard_in_progress",
          "Settlement is already in progress",
        ),
        409,
      );

    try {
      await reserveSettlementFee(
        context.env.DB,
        merchant.merchantId,
        identities.logicalPaymentKey,
        feeMicroUsd(context.env),
      );
    } catch (error) {
      await stub.abandonPrepared();
      if (errorCode(error) === "insufficient_service_balance") {
        const balance = await merchantBalance(
          context.env.DB,
          merchant.merchantId,
        );
        return context.json(
          {
            ...failure(
              network,
              "xguard_service_balance_required",
              "Merchant service balance cannot cover the XGuard fee",
            ),
            requiredFeeMicroUsd: feeMicroUsd(context.env),
            availableMicroUsd: balance.availableMicroUsd,
            topUpEndpoint: "/v1/topups/intents",
          },
          402,
        );
      }
      throw error;
    }

    if (!(await stub.start(PAYAI_ID))) {
      await releaseSettlementFee(
        context.env.DB,
        merchant.merchantId,
        identities.logicalPaymentKey,
      ).catch(() => undefined);
      return context.json(
        failure(
          network,
          "xguard_state_conflict",
          "Settlement ownership changed before submission",
        ),
        409,
      );
    }

    let result: SettleResponse;
    try {
      result = await payAISettle(
        context.env,
        body.raw,
        body.paymentRequirements,
        body.payer,
      );
    } catch (error) {
      await stub.markAmbiguous(errorCode(error));
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Submission started but final outcome is not trustworthy; automatic retry is disabled",
        ),
        503,
      );
    }

    if (!result.success) {
      await stub.finalize(result, result.errorReason ?? "downstream_rejected");
      await releaseSettlementFee(
        context.env.DB,
        merchant.merchantId,
        identities.logicalPaymentKey,
      );
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(result, 200, {
        "X-XGuard-Replayed": "false",
        "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      });
    }

    const now = new Date().toISOString();
    try {
      await context.env.DB.prepare(
        `INSERT INTO settlement_finality_jobs(logical_payment_key,merchant_id,transaction_hash,network,asset,expected_payer,expected_pay_to,expected_amount_micro_usd,settle_result_json,state,created_at,updated_at)
         VALUES(?,?,?,?,?,?,?,?,?,'PENDING',?,?)
         ON CONFLICT(logical_payment_key) DO NOTHING`,
      )
        .bind(
          identities.logicalPaymentKey,
          merchant.merchantId,
          result.transaction.toLowerCase(),
          BASE_MAINNET,
          BASE_USDC.toLowerCase(),
          body.payer.toLowerCase(),
          body.payTo.toLowerCase(),
          body.amountMicroUsd,
          JSON.stringify(result),
          now,
          now,
        )
        .run();
    } catch (error) {
      await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement was submitted but finality tracking could not be persisted; automatic retry is disabled",
        ),
        503,
      );
    }
    try {
      await stub.finalize(result);
    } catch (error) {
      await stub.markAmbiguous(errorCode(error)).catch(() => undefined);
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement was submitted but durable completion could not be recorded; automatic retry is disabled",
        ),
        503,
      );
    }
    context.executionCtx.waitUntil(stub.flushOutbox());
    return context.json(result, 200, {
      "X-XGuard-Replayed": "false",
      "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      "X-XGuard-Fee-State": "HELD_PENDING_FINALITY",
    });
  } catch (error) {
    return context.json(
      failure(network, errorCode(error), errorMessage(error)),
      errorStatus(error),
    );
  }
});

app.notFound((context) => context.json({ error: "not_found" }, 404));
app.onError((error, context) => {
  console.error(
    JSON.stringify({
      event: "unhandled_error",
      requestId: context.get("requestId"),
      code: errorCode(error),
    }),
  );
  return context.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: MainnetEnv,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<MainnetEnv>;

async function abuseProtection(
  context: AppContext,
  next: Next,
): Promise<Response | void> {
  const path = context.req.path;
  const requestId = context.get("requestId");
  const key = abuseClientKey(context.req.raw);
  try {
    const [client, global] = await Promise.all([
      context.env.REQUEST_RATE_LIMITER.limit({ key: `${path}:${key}` }),
      context.env.GLOBAL_RATE_LIMITER.limit({ key: path }),
    ]);
    if (!client.success || !global.success)
      return context.json({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch {
    return context.json({ error: "protection_unavailable" }, 503);
  }

  const gate = context.env.REQUEST_GATE.getByName(key);
  let acquired = false;
  try {
    acquired = await gate.acquire(
      requestId,
      Date.now(),
      CLIENT_LEASE_MS,
      CLIENT_CONCURRENCY_LIMIT,
    );
    if (!acquired)
      return context.json({ error: "concurrency_limit_exceeded" }, 429, {
        "Retry-After": "1",
      });
    await next();
  } finally {
    if (acquired) await gate.release(requestId).catch(() => undefined);
  }
}

function observeEconomicFirewallShadow(
  context: AppContext,
  merchant: MerchantIdentity,
  request: ParsedMainnetRequest,
  operation: "verify" | "settle",
): void {
  if (
    parseMainnetEconomicShadowMode(
      context.env.ECONOMIC_FIREWALL_SHADOW_MODE,
    ) !== "observe"
  )
    return;

  try {
    const shadow = deriveMainnetEconomicShadowBinding(
      merchant.merchantId,
      request,
    );
    console.log(
      JSON.stringify({
        event: "economic_firewall_shadow_bound",
        requestId: context.get("requestId"),
        operation,
        merchantId: merchant.merchantId,
        intentId: shadow.intent.intentId,
        termsHash: shadow.intent.termsHash,
        authorizationHash: shadow.authorizationHash,
        amountMicroUsd: shadow.amountMicroUsd,
      }),
    );
    context.executionCtx.waitUntil(
      persistEconomicFirewallObservation(context, merchant, shadow, operation),
    );
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "economic_firewall_shadow_rejected",
        requestId: context.get("requestId"),
        operation,
        merchantId: merchant.merchantId,
        code: errorCode(error),
      }),
    );
  }
}

async function persistEconomicFirewallObservation(
  context: AppContext,
  merchant: MerchantIdentity,
  shadow: ReturnType<typeof deriveMainnetEconomicShadowBinding>,
  operation: "verify" | "settle",
): Promise<void> {
  if (
    operation === "settle" &&
    parseMainnetEconomicAuditMode(context.env.ECONOMIC_FIREWALL_AUDIT_MODE) ===
      "audit"
  ) {
    try {
      const decision = await evaluateMainnetEconomicSettlementAudit(
        context.env.DB,
        merchant.merchantId,
        shadow,
      );
      console.log(
        JSON.stringify({
          event: "economic_firewall_audit_decision",
          requestId: context.get("requestId"),
          verdict: decision.verdict,
          reason: decision.reason,
          intentId: shadow.intent.intentId,
        }),
      );
      await recordMainnetEconomicAuditDecision(context.env.DB, decision);
    } catch (error) {
      console.warn(
        JSON.stringify({
          event: "economic_firewall_audit_failed",
          requestId: context.get("requestId"),
          code: errorCode(error),
        }),
      );
    }
  }

  await recordMainnetEconomicShadowObservation(
    context.env.DB,
    merchant.merchantId,
    shadow,
    operation,
  ).catch((error) =>
    console.warn(
      JSON.stringify({
        event: "economic_firewall_shadow_telemetry_write_failed",
        requestId: context.get("requestId"),
        operation,
        merchantId: merchant.merchantId,
        code: errorCode(error),
      }),
    ),
  );
}

async function requireMerchant(context: AppContext): Promise<MerchantIdentity> {
  const authorization = context.req.header("authorization");
  if (authorization === undefined || !authorization.startsWith("Bearer "))
    throw new XGuardError(
      "UNAUTHORIZED",
      "Bearer merchant API key is required",
      401,
    );
  const merchant = await authenticateMerchant(
    context.env.DB,
    authorization.slice("Bearer ".length),
  );
  if (merchant === null)
    throw new XGuardError("UNAUTHORIZED", "Merchant API key is invalid", 401);
  return merchant;
}

async function claimPaymentIdentifier(
  env: MainnetEnv,
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
      `INSERT INTO payment_identifiers(identifier,logical_payment_key,expires_at_epoch,created_at) VALUES(?,?,?,?)
       ON CONFLICT(identifier) DO UPDATE SET logical_payment_key=excluded.logical_payment_key,expires_at_epoch=excluded.expires_at_epoch,created_at=excluded.created_at
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
      "Payment identifier is bound to another active authorization",
      409,
    );
}

async function runMaintenance(env: MainnetEnv): Promise<void> {
  assertRuntimeConfig(env);
  await refreshPayAIHealth(env).catch((error) =>
    console.error(
      JSON.stringify({ event: "payai_health_failed", code: errorCode(error) }),
    ),
  );
  if (
    parseMainnetEconomicShadowMode(env.ECONOMIC_FIREWALL_SHADOW_MODE) ===
    "observe"
  )
    await pruneMainnetEconomicShadowTelemetry(env.DB).catch((error) =>
      console.warn(
        JSON.stringify({
          event: "economic_firewall_shadow_telemetry_prune_failed",
          code: errorCode(error),
        }),
      ),
    );
  const nowEpoch = Math.floor(Date.now() / 1_000);
  await env.DB.batch([
    env.DB.prepare(
      "DELETE FROM payment_identifiers WHERE expires_at_epoch<?",
    ).bind(nowEpoch),
    env.DB.prepare(
      "UPDATE top_up_intents SET state='EXPIRED' WHERE state='OPEN' AND expires_at_epoch<?",
    ).bind(nowEpoch),
  ]);
  await processFinalityJobs(env);
}

async function refreshPayAIHealth(env: MainnetEnv): Promise<void> {
  const started = performance.now();
  const now = new Date().toISOString();
  try {
    const supported = await fetchPayAISupported(env);
    await env.DB.prepare(
      `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,latency_ms,last_error_code,capabilities_json,checked_at)
       VALUES(?,'HEALTHY',0,?,NULL,?,?)
       ON CONFLICT(facilitator_id) DO UPDATE SET state='HEALTHY',consecutive_failures=0,latency_ms=excluded.latency_ms,last_error_code=NULL,capabilities_json=excluded.capabilities_json,checked_at=excluded.checked_at`,
    )
      .bind(
        PAYAI_ID,
        Math.round(performance.now() - started),
        JSON.stringify(supported),
        now,
      )
      .run();
  } catch (error) {
    await env.DB.prepare(
      `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,last_error_code,checked_at)
       VALUES(?,'DEGRADED',1,?,?)
       ON CONFLICT(facilitator_id) DO UPDATE SET state=CASE WHEN facilitator_health.consecutive_failures>=2 THEN 'OPEN' ELSE 'DEGRADED' END,consecutive_failures=facilitator_health.consecutive_failures+1,last_error_code=excluded.last_error_code,checked_at=excluded.checked_at`,
    )
      .bind(PAYAI_ID, errorCode(error), now)
      .run();
    throw error;
  }
}

async function processFinalityJobs(env: MainnetEnv): Promise<void> {
  const jobs = await env.DB.prepare(
    "SELECT logical_payment_key,merchant_id,transaction_hash,network,asset,expected_payer,expected_pay_to,expected_amount_micro_usd,settle_result_json,attempts FROM settlement_finality_jobs WHERE state='PENDING' ORDER BY updated_at LIMIT ?",
  )
    .bind(FINALITY_BATCH_SIZE)
    .all<FinalityJob>();
  for (const job of jobs.results) {
    const now = new Date().toISOString();
    try {
      await verifyFinalizedBaseUsdcSettlement({
        rpcUrl: env.BASE_RPC_URL,
        transactionHash: job.transaction_hash,
        usdcContractAddress: job.asset,
        expectedPayer: job.expected_payer,
        expectedPayTo: job.expected_pay_to,
        expectedAmountMicroUsd: job.expected_amount_micro_usd,
      });
      const projection = await env.DB.prepare(
        "SELECT logical_payment_key FROM settlement_projection WHERE logical_payment_key=?",
      )
        .bind(job.logical_payment_key)
        .first<{ logical_payment_key: string }>();
      if (projection === null) {
        await env.DB.prepare(
          "UPDATE settlement_finality_jobs SET attempts=attempts+1,last_error_code='projection_pending',updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
        )
          .bind(now, job.logical_payment_key)
          .run();
        continue;
      }
      await env.DB.prepare(
        "UPDATE settlement_projection SET state='SETTLED',fee_micro_usd=?,downstream_cost_micro_usd=?,recorded_at=? WHERE logical_payment_key=?",
      )
        .bind(
          feeMicroUsd(env),
          downstreamCostMicroUsd(env),
          now,
          job.logical_payment_key,
        )
        .run();
      await earnSettlementFee(env.DB, job.merchant_id, job.logical_payment_key);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE settlement_finality_jobs SET state='CONFIRMED',attempts=attempts+1,last_error_code=NULL,updated_at=?,confirmed_at=? WHERE logical_payment_key=? AND state='PENDING'",
        ).bind(now, now, job.logical_payment_key),
        env.DB.prepare(
          "UPDATE reconciliation_cases SET state='RESOLVED',resolved_at=? WHERE logical_payment_key=? AND state='OPEN'",
        ).bind(now, job.logical_payment_key),
      ]);
    } catch (error) {
      const code = errorCode(error);
      const permanentFinalityFailure =
        code === "transaction_failed_finalized" ||
        code === "expected_usdc_transfer_not_found" ||
        code === "ambiguous_expected_usdc_transfer";
      if (!permanentFinalityFailure) {
        await env.DB.prepare(
          "UPDATE settlement_finality_jobs SET attempts=attempts+1,last_error_code=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
        )
          .bind(code, now, job.logical_payment_key)
          .run();
        continue;
      }
      await releaseSettlementFee(
        env.DB,
        job.merchant_id,
        job.logical_payment_key,
      ).catch(() => undefined);
      await env.DB.batch([
        env.DB.prepare(
          "UPDATE settlement_finality_jobs SET state='FAILED',attempts=attempts+1,last_error_code=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
        ).bind(code, now, job.logical_payment_key),
        env.DB.prepare(
          "UPDATE settlement_projection SET state='FAILED',fee_micro_usd=0,recorded_at=? WHERE logical_payment_key=?",
        ).bind(now, job.logical_payment_key),
        env.DB.prepare(
          `INSERT INTO reconciliation_cases(case_id,logical_payment_key,reason_code,details_json,state,created_at)
           VALUES(?,?,?,?,'OPEN',?) ON CONFLICT(case_id) DO NOTHING`,
        ).bind(
          `finality:${job.logical_payment_key}`,
          job.logical_payment_key,
          code,
          JSON.stringify({ transactionHash: job.transaction_hash }),
          now,
        ),
      ]);
    }
  }
}

async function currentPayAIHealth(env: MainnetEnv): Promise<{
  state: string;
  capabilities_json: string;
} | null> {
  const cutoff = new Date(
    Date.now() -
      boundedInteger(
        env.HEALTH_MAX_AGE_SECONDS,
        30,
        3_600,
        "HEALTH_MAX_AGE_SECONDS",
      ) *
        1_000,
  ).toISOString();
  return env.DB.prepare(
    "SELECT state,capabilities_json FROM facilitator_health WHERE facilitator_id=? AND checked_at>=? AND capabilities_json IS NOT NULL",
  )
    .bind(PAYAI_ID, cutoff)
    .first<{ state: string; capabilities_json: string }>();
}

async function requireHealthyPayAI(env: MainnetEnv): Promise<void> {
  if (downstreamCostMicroUsd(env) >= feeMicroUsd(env))
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      "Current facilitator cost would make XGuard unit economics non-positive",
      503,
    );

  const health = await currentPayAIHealth(env);
  if (health !== null && health.state === "HEALTHY") return;

  try {
    await refreshPayAIHealth(env);
  } catch {
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      "No current healthy Base mainnet facilitator route is available",
      503,
      true,
    );
  }

  const recovered = await currentPayAIHealth(env);
  if (recovered === null || recovered.state !== "HEALTHY")
    throw new XGuardError(
      "FACILITATOR_UNAVAILABLE",
      "No current healthy Base mainnet facilitator route is available",
      503,
      true,
    );
}

function assertRuntimeConfig(env: MainnetEnv): void {
  if (!/^0x[0-9a-fA-F]{40}$/.test(env.XGUARD_TREASURY_USDC_ADDRESS))
    throw new Error("invalid_treasury_address");
  const rpc = new URL(env.BASE_RPC_URL);
  if (rpc.protocol !== "https:" || rpc.username || rpc.password)
    throw new Error("invalid_base_rpc_url");
  feeMicroUsd(env);
  downstreamCostMicroUsd(env);
}

function feeMicroUsd(env: MainnetEnv): number {
  return boundedInteger(
    env.XGUARD_FEE_MICRO_USD,
    1,
    1_000_000,
    "XGUARD_FEE_MICRO_USD",
  );
}

function downstreamCostMicroUsd(env: MainnetEnv): number {
  return boundedInteger(
    env.PAYAI_DOWNSTREAM_COST_MICRO_USD,
    0,
    1_000_000,
    "PAYAI_DOWNSTREAM_COST_MICRO_USD",
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

function parseUsdToMicro(value: unknown): number {
  if (
    typeof value !== "string" ||
    !/^(?:0|[1-9][0-9]*)(?:\.[0-9]{1,6})?$/.test(value)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "amountUsd must be a non-negative decimal string with at most 6 decimals",
      400,
    );
  const [whole, fraction = ""] = value.split(".");
  const amount = BigInt(whole!) * 1_000_000n + BigInt(fraction.padEnd(6, "0"));
  if (amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new XGuardError("BAD_REQUEST", "amountUsd is too large", 400);
  return Number(amount);
}

function microUsdToUsd(value: number): string {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction}`;
}

function abuseClientKey(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (authorization !== null)
    return `authorization:${sha256Hex(authorization)}`;
  const ip = request.headers.get("cf-connecting-ip") ?? "anonymous";
  return `anonymous:${sha256Hex(ip)}`;
}

function failure(
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

function errorJson(context: AppContext, error: unknown): Response {
  return context.json(
    { error: errorCode(error), message: errorMessage(error) },
    errorStatus(error),
  );
}

function errorCode(error: unknown): string {
  if (error instanceof XGuardError) return error.code.toLowerCase();
  if (error instanceof Error)
    return error.name === "AbortError"
      ? "AbortError"
      : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return "unknown_error";
}

function errorMessage(error: unknown): string {
  if (error instanceof XGuardError) return error.message;
  if (error instanceof Error)
    return "XGuard could not safely complete the request";
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
  return 500;
}
