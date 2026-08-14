import { createHmac, timingSafeEqual } from "node:crypto";
import { getConnInfo } from "@hono/node-server/conninfo";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import {
  parsePaymentPayload,
  parsePaymentRequirements,
} from "@x402/core/schemas";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from "@x402/core/types";
import {
  AmbiguousSettlementError,
  SettlementCoordinator,
  SqliteFinancialStore,
  XGuardError,
  formatMicroUsd,
  parseJsonStrict,
  type RoutingEngine,
} from "@xguard/core";
import { readHttpBodyTextCapped } from "@xguard/core/edge";
import { checkEndpoint } from "./checker.js";
import type { GatewayConfig } from "./config.js";
import { GatewayMetrics } from "./metrics.js";

export interface AppDependencies {
  config: GatewayConfig;
  coordinator: SettlementCoordinator;
  store: SqliteFinancialStore;
  router: RoutingEngine;
  metrics?: GatewayMetrics;
}

type Variables = { requestId: string };

export function createApp(
  dependencies: AppDependencies,
): Hono<{ Variables: Variables }> {
  const { config, coordinator, store, router } = dependencies;
  const metrics = dependencies.metrics ?? new GatewayMetrics();
  const app = new Hono<{ Variables: Variables }>();
  const limiter = new RateLimiter(120, 60_000);

  app.use("*", async (context, next) => securityMiddleware(context, next));
  app.use("*", async (context, next) => {
    let key = "in-process";
    try {
      key = getConnInfo(context).remote.address ?? key;
    } catch {
      // Hono's in-process app.request() test adapter has no socket binding.
    }
    if (!limiter.take(key))
      return context.json({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
    const started = performance.now();
    await next();
    metrics.observeLatency(performance.now() - started);
    metrics.increment("requests_total");
    return;
  });

  app.get("/", (context) => context.html(landingPage()));
  app.get("/healthz", (context) =>
    context.json({
      status: "ok",
      mode: config.mainnetEnabled ? "mainnet-gated" : "testnet",
      version: "0.1.0-alpha.0",
    }),
  );
  app.get("/readyz", (context) => {
    const ledger = store.verifyLedgerBalance();
    const supported = coordinator.supported();
    const ready = ledger.balanced && supported.kinds.length > 0;
    return context.json(
      {
        status: ready ? "ready" : "not_ready",
        ledgerBalanced: ledger.balanced,
        supportedRoutes: supported.kinds.length,
      },
      ready ? 200 : 503,
    );
  });
  app.get("/supported", (context) => context.json(coordinator.supported()));
  app.get("/status", (context) => {
    const financial = store.getFinancialReport(
      config.reservePercent,
      config.minimumReserveMicroUsd,
    );
    const snapshots = router.snapshots();
    const available = snapshots.some(
      (item) =>
        item.capabilities !== null &&
        (item.state === "HEALTHY" || item.state === "DEGRADED"),
    );
    return context.json({
      gateway: available ? "operational" : "degraded",
      verification: available ? "operational" : "degraded",
      settlement: available ? "operational" : "degraded",
      mode: config.mainnetEnabled ? "mainnet-gated" : "testnet-only",
      ambiguousSettlements: financial.ambiguousSettlementCount.toString(),
      measuredAt: new Date().toISOString(),
    });
  });
  app.get("/status/page", (context) =>
    context.html(statusPage(router.snapshots(), config.mainnetEnabled)),
  );
  app.get("/metrics", (context) =>
    context.text(metrics.prometheus(), 200, {
      "Content-Type": "text/plain; version=0.0.4; charset=utf-8",
    }),
  );

  app.post("/verify", async (context) => {
    let request: FacilitatorRequest | null = null;
    try {
      request = await parseFacilitatorRequest(context);
      const merchant = authenticateMerchant(
        context,
        store,
        config,
        request.paymentRequirements.network,
      );
      const outcome = await coordinator.verify(
        merchant.id,
        request.paymentPayload,
        request.paymentRequirements,
      );
      metrics.increment(
        outcome.result.isValid
          ? "verify_success_total"
          : "verify_rejected_total",
      );
      return context.json(outcome.result, 200, {
        "X-XGuard-Payment-Key": outcome.paymentKey,
      });
    } catch (error) {
      metrics.increment("verify_error_total");
      const normalized = normalizeError(error);
      return context.json(
        {
          isValid: false,
          invalidReason: normalized.code.toLowerCase(),
          invalidMessage: normalized.message,
        },
        asHttpStatus(normalized.status),
      );
    }
  });

  app.post("/settle", async (context) => {
    let request: FacilitatorRequest | null = null;
    try {
      request = await parseFacilitatorRequest(context);
      const merchant = authenticateMerchant(
        context,
        store,
        config,
        request.paymentRequirements.network,
      );
      const outcome = await coordinator.settle(
        merchant.id,
        request.paymentPayload,
        request.paymentRequirements,
      );
      if (outcome.result.success) metrics.increment("settlement_success_total");
      else metrics.increment("settlement_rejected_total");
      if (outcome.replayed) metrics.increment("duplicate_prevented_total");
      return context.json(outcome.result, 200, {
        "X-XGuard-Payment-Key": outcome.paymentKey,
        "X-XGuard-Replayed": outcome.replayed ? "true" : "false",
      });
    } catch (error) {
      const normalized = normalizeError(error);
      if (error instanceof AmbiguousSettlementError)
        metrics.increment("settlement_ambiguous_total");
      else metrics.increment("settlement_error_total");
      const network = request?.paymentRequirements.network ?? "eip155:84532";
      const result: SettleResponse = {
        success: false,
        transaction: "",
        network: network as `${string}:${string}`,
        errorReason: normalized.code.toLowerCase(),
        errorMessage: normalized.message,
      };
      return context.json(result, asHttpStatus(normalized.status));
    }
  });

  app.get("/v1/payments/:paymentKey", (context) => {
    const merchant = authenticateMerchant(context, store, config, null);
    const payment = store.getPayment(context.req.param("paymentKey"));
    if (payment === null || payment.merchantId !== merchant.id)
      return context.json({ error: "not_found" }, 404);
    return context.json({
      paymentKey: payment.logicalPaymentKey,
      state: payment.state,
      network: payment.network,
      testnet: payment.testnet,
      facilitatorId: payment.facilitatorId,
      createdAt: payment.createdAt,
      updatedAt: payment.updatedAt,
    });
  });

  app.get("/v1/balance", (context) => {
    const merchant = authenticateMerchant(context, store, config, null);
    const testnetOnly = merchant.id === "public-testnet";
    return context.json({
      merchantId: merchant.id,
      availableBalanceUsd: formatMicroUsd(merchant.availableBalanceMicroUsd),
      lowBalance:
        !testnetOnly &&
        merchant.availableBalanceMicroUsd < config.lowBalanceThresholdMicroUsd,
      lowBalanceThresholdUsd: formatMicroUsd(
        config.lowBalanceThresholdMicroUsd,
      ),
      feePerBillableSettlementUsd: formatMicroUsd(config.feeMicroUsd),
      testnetCharged: false,
      autoTopUpAuthorized: false,
      topUpProviderState: "EXTERNAL_BLOCKER",
    });
  });

  app.post("/v1/check", async (context) => {
    try {
      const body = asRecord(
        parseJsonStrict(
          await readHttpBodyTextCapped(
            context.req.raw,
            4_096,
            "Compatibility-check request body",
          ),
          {
            maxBytes: 4_096,
            maxDepth: 4,
            maxKeys: 10,
          },
        ),
      );
      if (typeof body.url !== "string")
        throw new XGuardError("BAD_REQUEST", "url must be a string", 400);
      const result = await checkEndpoint(body.url);
      metrics.increment("compatibility_checks_total");
      return context.json(result);
    } catch (error) {
      const normalized = normalizeError(error);
      return context.json(
        { error: normalized.code.toLowerCase(), message: normalized.message },
        asHttpStatus(normalized.status),
      );
    }
  });

  app.get("/owner/report", (context) => {
    try {
      requireAdmin(context, config);
      const report = store.getFinancialReport(
        config.reservePercent,
        config.minimumReserveMicroUsd,
      );
      const ledger = store.verifyLedgerBalance();
      return context.json({
        transactions: report.transactionCount.toString(),
        billableSettlements: report.billableSettlementCount.toString(),
        grossXGuardRevenueUsd: formatMicroUsd(report.grossRevenueMicroUsd),
        operatingCostsUsd: formatMicroUsd(report.operatingCostsMicroUsd),
        contributionUsd: formatMicroUsd(report.contributionMicroUsd),
        customerLiabilitiesUsd: formatMicroUsd(
          report.customerLiabilitiesMicroUsd,
        ),
        availableTreasuryUsd: formatMicroUsd(report.availableTreasuryMicroUsd),
        operatingReserveUsd: formatMicroUsd(report.operatingReserveMicroUsd),
        distributableProfitUsd: formatMicroUsd(
          report.ownerDistributableMicroUsd,
        ),
        pendingOwnerPayoutUsd: formatMicroUsd(
          report.pendingOwnerPayoutMicroUsd,
        ),
        paidOwnerProfitUsd: formatMicroUsd(report.paidOwnerProfitMicroUsd),
        ledgerBalanced: ledger.balanced,
        payoutState: "EXTERNAL_BLOCKER",
      });
    } catch (error) {
      const normalized = normalizeError(error);
      return context.json(
        { error: normalized.code.toLowerCase(), message: normalized.message },
        asHttpStatus(normalized.status),
      );
    }
  });

  app.notFound((context) => context.json({ error: "not_found" }, 404));
  app.onError((error, context) => {
    logEvent("request_error", context.get("requestId"), { name: error.name });
    return context.json({ error: "internal_error" }, 500);
  });
  return app;
}

interface FacilitatorRequest {
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

async function parseFacilitatorRequest(
  context: Context,
): Promise<FacilitatorRequest> {
  const contentType = context.req
    .header("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (contentType !== "application/json")
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  const body = asRecord(
    parseJsonStrict(
      await readHttpBodyTextCapped(
        context.req.raw,
        64 * 1024,
        "Facilitator request body",
      ),
    ),
  );
  assertExactKeys(body, [
    "x402Version",
    "paymentPayload",
    "paymentRequirements",
  ]);
  if (body.x402Version !== 2)
    throw new XGuardError(
      "UNSUPPORTED",
      "Only x402 v2 facilitator requests are accepted",
      400,
    );
  const payload = parsePaymentPayload(body.paymentPayload);
  const requirements = parsePaymentRequirements(body.paymentRequirements);
  if (!payload.success)
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentPayload does not match the official x402 schema",
      400,
    );
  if (!requirements.success)
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentRequirements does not match the official x402 schema",
      400,
    );
  if (payload.data.x402Version !== 2 || !("accepted" in payload.data))
    throw new XGuardError(
      "UNSUPPORTED",
      "Only x402 v2 payment payloads are accepted",
      400,
    );
  if (!("amount" in requirements.data))
    throw new XGuardError(
      "UNSUPPORTED",
      "Only x402 v2 payment requirements are accepted",
      400,
    );
  const paymentPayload = payload.data as PaymentPayload;
  const paymentRequirements = requirements.data as PaymentRequirements;
  paymentPayload.accepted.extra ??= {};
  paymentRequirements.extra ??= {};
  return { paymentPayload, paymentRequirements };
}

function authenticateMerchant(
  context: Context,
  store: SqliteFinancialStore,
  config: GatewayConfig,
  network: string | null,
) {
  const authorization = context.req.header("authorization");
  if (
    authorization === undefined &&
    config.publicTestnet &&
    (network === null || network === "eip155:84532")
  ) {
    const merchant = store.getMerchant("public-testnet");
    if (merchant === null)
      throw new XGuardError(
        "INTERNAL_ERROR",
        "Public testnet merchant is not initialized",
        500,
      );
    return merchant;
  }
  if (authorization === undefined || !authorization.startsWith("Bearer "))
    throw new XGuardError(
      "UNAUTHORIZED",
      "A bearer merchant API key is required",
      401,
    );
  const token = authorization.slice("Bearer ".length);
  if (!/^xg_(?:test|live)_[A-Za-z0-9_-]{32,}$/.test(token))
    throw new XGuardError(
      "UNAUTHORIZED",
      "Merchant API key format is invalid",
      401,
    );
  const merchant = store.findMerchantByApiKeyHash(
    hashApiKey(token, config.apiKeyPepper),
  );
  if (merchant === null || !merchant.active)
    throw new XGuardError(
      "UNAUTHORIZED",
      "Merchant API key is invalid or disabled",
      401,
    );
  return merchant;
}

export function hashApiKey(apiKey: string, pepper: string): string {
  return createHmac("sha256", pepper).update(apiKey, "utf8").digest("hex");
}

function requireAdmin(context: Context, config: GatewayConfig): void {
  if (config.adminToken === null)
    throw new XGuardError(
      "UNAUTHORIZED",
      "Owner dashboard is disabled until an admin secret is configured",
      404,
    );
  const supplied =
    context.req.header("authorization")?.replace(/^Bearer /, "") ?? "";
  const expectedBuffer = Buffer.from(config.adminToken);
  const suppliedBuffer = Buffer.from(supplied);
  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !timingSafeEqual(expectedBuffer, suppliedBuffer)
  )
    throw new XGuardError("UNAUTHORIZED", "Admin authentication failed", 401);
}

async function securityMiddleware(
  context: Context<{ Variables: Variables }>,
  next: Next,
): Promise<void> {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  await next();
  context.header("X-Request-ID", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=()",
  );
  context.header(
    "Content-Security-Policy",
    "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
  );
  context.header(
    "Cache-Control",
    context.req.path === "/" || context.req.path.startsWith("/status")
      ? "public, max-age=30"
      : "no-store",
  );
}

function normalizeError(error: unknown): XGuardError {
  if (error instanceof XGuardError) return error;
  return new XGuardError(
    "INTERNAL_ERROR",
    "XGuard failed closed while processing the request",
    500,
  );
}

function asHttpStatus(status: number): ContentfulStatusCode {
  return status as ContentfulStatusCode;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", "JSON body must be an object", 400);
  return value as Record<string, unknown>;
}

function assertExactKeys(
  record: Record<string, unknown>,
  keys: readonly string[],
): void {
  const expected = new Set(keys);
  const unknown = Object.keys(record).filter((key) => !expected.has(key));
  const missing = keys.filter((key) => !(key in record));
  if (unknown.length > 0 || missing.length > 0)
    throw new XGuardError(
      "BAD_REQUEST",
      `Invalid top-level fields; unknown=[${unknown.join(",")}], missing=[${missing.join(",")}]`,
      400,
    );
}

class RateLimiter {
  private readonly buckets = new Map<
    string,
    { count: number; resetAt: number }
  >();
  public constructor(
    private readonly maximum: number,
    private readonly windowMs: number,
  ) {}
  public take(key: string): boolean {
    const now = Date.now();
    if (this.buckets.size > 10_000) {
      for (const [bucketKey, bucket] of this.buckets) {
        if (bucket.resetAt <= now) this.buckets.delete(bucketKey);
      }
      if (this.buckets.size > 10_000) return false;
    }
    const existing = this.buckets.get(key);
    if (existing === undefined || existing.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (existing.count >= this.maximum) return false;
    existing.count += 1;
    return true;
  }
}

function logEvent(
  event: string,
  requestId: string,
  fields: Record<string, string>,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      requestId,
      ...fields,
    }),
  );
}

function landingPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard — one safe route for x402</title><style>${styles()}</style></head><body><main><p class="eyebrow">XGUARD · X402 V2 · TESTNET ALPHA</p><h1>One safe route for x402 payments.</h1><p class="lead">Health-aware facilitator selection, permanent replay protection, conservative settlement handling, immutable usage accounting, and no monthly subscription.</p><section><h2>Install after npm publication</h2><pre>npx xguard@latest init</pre><p>Diagnose: <code>npx xguard@latest doctor</code> · Remove: <code>npx xguard rollback</code></p><p>The alpha package is prepared but not yet published.</p></section><section class="grid"><article><h2>Routing</h2><p>One facilitator-compatible integration with capability and health filtering.</p></article><article><h2>Safety</h2><p>Never retries an ambiguous submitted settlement. Duplicate logical payments are suppressed.</p></article><article><h2>Price</h2><p><strong>$0.002</strong> per successful billable settlement. Testnet, failures, duplicates and ambiguous outcomes are not billed. Downstream fees are separate.</p></article></section><p class="notice">Mainnet settlement and real fee collection are disabled in this alpha pending legal and operational gates. No official endorsement is claimed.</p><p><a href="/status/page">Service status</a> · <a href="/supported">Machine-readable capabilities</a></p></main></body></html>`;
}

function statusPage(
  snapshots: ReturnType<RoutingEngine["snapshots"]>,
  mainnet: boolean,
): string {
  const healthy = snapshots.filter((item) => item.state === "HEALTHY").length;
  const gatewayState = healthy > 0 ? "Operational" : "Degraded";
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Status</title><style>${styles()}</style></head><body><main><p class="eyebrow">XGUARD STATUS</p><h1>${healthy > 0 ? "All monitored testnet routes operational" : "Testnet routes degraded"}</h1><section class="grid"><article><h2>Gateway</h2><p>${gatewayState}</p></article><article><h2>Facilitator routes</h2><p>${healthy} healthy route(s)</p></article><article><h2>Mode</h2><p>${mainnet ? "Mainnet gated" : "Testnet only"}</p></article></section><p class="notice">Status is based on measured checks. No historical uptime is claimed until enough real observations exist.</p><p><a href="/status">JSON status</a></p></main></body></html>`;
}

function styles(): string {
  return `:root{color-scheme:dark;font-family:Inter,ui-sans-serif,system-ui;background:#080a0c;color:#f4f7f8}body{margin:0}main{max-width:980px;margin:auto;padding:8vw 24px}.eyebrow{color:#7bf1a8;letter-spacing:.16em;font-size:12px;font-weight:800}h1{font-size:clamp(44px,8vw,88px);line-height:.95;max-width:850px;margin:28px 0}.lead{font-size:21px;line-height:1.55;color:#bdc7ca;max-width:760px}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin:40px 0}article,section{border:1px solid #293034;border-radius:16px;padding:20px;background:#0e1215}section>h2,article h2{font-size:16px}pre{overflow:auto;background:#050607;padding:18px;border-radius:10px;color:#7bf1a8}.notice{border-left:3px solid #f5c451;padding:12px 16px;color:#d7d1bd}a{color:#7bf1a8}code{color:#dce7e9}`;
}
