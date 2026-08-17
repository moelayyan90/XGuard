export const XGUARD_FINALIZED_FEE_BPS = 50;
export const XGUARD_FINALIZED_FEE_USD = "0.001";
export const XGUARD_FINALIZED_FEE_MICRO_USD = 1000;
/** @deprecated Compatibility aliases for callers that imported the old names. */
export const XGUARD_ATTEMPT_FEE_USD = XGUARD_FINALIZED_FEE_USD;
/** @deprecated Compatibility aliases for callers that imported the old names. */
export const XGUARD_ATTEMPT_FEE_MICRO_USD = XGUARD_FINALIZED_FEE_MICRO_USD;

const MACHINE_PATHS = new Set([
  "/.well-known/payment-manifest",
  "/.well-known/payment-manifest.json",
  "/.well-known/payments.json",
  "/.well-known/xguard/payments.json",
  "/payment-manifest",
  "/payments",
]);
const HUMAN_PATHS = new Set(["/pay", "/payment", "/pricing"]);
const NORMALIZE_PATHS = new Set([
  "/",
  "/docs",
  "/quickstart",
  "/llms.txt",
  "/llms-full.txt",
  "/provider.json",
  "/.well-known/x402.json",
  "/.well-known/x402/facilitator.json",
  "/.well-known/agent-market.json",
  "/.well-known/xguard.json",
]);

type PaymentEnv = {
  XGUARD_TREASURY_USDC_ADDRESS?: string;
  XGUARD_PRICING_VERSION?: string;
  XGUARD_FEE_BPS?: string;
  XGUARD_FEE_CAP_MICRO_USD?: string;
  XGUARD_POSTPAID_LIMIT_MICRO_USD?: string;
};

export function publicPaymentContractResponse(
  request: Request,
  env: PaymentEnv,
): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const { pathname, origin } = new URL(request.url);
  if (MACHINE_PATHS.has(pathname)) return json(request, manifest(origin, env));
  if (!HUMAN_PATHS.has(pathname)) return null;
  if ((request.headers.get("accept") ?? "").includes("application/json"))
    return json(request, manifest(origin, env));
  return html(request, paymentPage(origin, env));
}

export function buildPaymentManifest(
  origin: string,
  env: PaymentEnv,
): Record<string, unknown> {
  return manifest(origin, env);
}

function manifest(origin: string, env: PaymentEnv): Record<string, unknown> {
  return {
    manifest: "xguard-payment-manifest-v2",
    name: "XGuard",
    mode: "production",
    protocol: "x402-v2",
    network: "eip155:8453",
    asset: {
      symbol: "USDC",
      contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      ...(env.XGUARD_TREASURY_USDC_ADDRESS
        ? { treasury: env.XGUARD_TREASURY_USDC_ADDRESS }
        : {}),
    },
    pricing: {
      pricingVersion: env.XGUARD_PRICING_VERSION ?? "2026-08-zero-friction-v1",
      model: "capped_revenue_share_after_finality",
      feeBps: parseFeeBps(env.XGUARD_FEE_BPS),
      feePercent: `${parseFeeBps(env.XGUARD_FEE_BPS) / 100}%`,
      feeCapUsd: microUsdToUsd(parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD)),
      feeCapMicroUsd: parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD),
      event: "independently_finalized_successful_settlement",
      billing: "postpaid_capped_revenue_share",
      verifyFeeUsd: "0",
      failedSettlementFeeUsd: "0",
      retryAdditionalFeeUsd: "0",
      postpaidLimitMicroUsd: parseLimit(env.XGUARD_POSTPAID_LIMIT_MICRO_USD),
    },
    onboarding: {
      accountRequired: false,
      emailRequired: false,
      passwordRequired: false,
      apiKeyRequired: false,
      prepaymentRequired: false,
      walletActivation: "one_signature",
      activation: `${origin}/start`,
      instruction: `Activate payTo once at ${origin}/start, then set the standard x402 facilitator URL to ${origin}`,
      quickstart: `${origin}/start`,
      feeBalance: `${origin}/v1/fees?payTo={payTo}`,
      feeClaim: `${origin}/v1/fees/claim`,
    },
    execution: {
      supported: `${origin}/supported`,
      verify: `${origin}/verify`,
      settle: `${origin}/settle`,
      settlementTruth: `${origin}/v1/settlements/{logicalPaymentKey}/truth`,
      settlementResolve: `${origin}/v1/settlements/{logicalPaymentKey}/resolve`,
    },
    agentInterfaces: {
      a2a: `${origin}/a2a`,
      agentCard: `${origin}/.well-known/agent-card.json`,
      mcp: `${origin}/mcp`,
      mcpManifest: `${origin}/.well-known/mcp/server.json`,
      openapi: `${origin}/openapi.json`,
    },
    discoveryAliases: [
      `${origin}/.well-known/payment-manifest`,
      `${origin}/.well-known/payment-manifest.json`,
      `${origin}/.well-known/payments.json`,
      `${origin}/.well-known/xguard/payments.json`,
      `${origin}/.well-known/x402/facilitator.json`,
    ],
  };
}

export async function normalizePublicPaymentContract(
  request: Request,
  response: Response,
): Promise<Response> {
  if (!response.ok || (request.method !== "GET" && request.method !== "HEAD"))
    return response;
  if (!NORMALIZE_PATHS.has(new URL(request.url).pathname)) return response;

  const type = response.headers.get("content-type")?.toLowerCase() ?? "";
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("X-XGuard-Pricing-Contract", "postpaid-finality-v2");

  if (type.includes("application/json")) {
    try {
      const value = normalizeJson(await response.clone().json());
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "public, max-age=300");
      return new Response(
        request.method === "HEAD" ? null : JSON.stringify(value),
        {
          status: response.status,
          statusText: response.statusText,
          headers,
        },
      );
    } catch {
      return response;
    }
  }

  if (type.includes("text/")) {
    headers.set("cache-control", "no-store");
    const text = normalizeText(await response.text());
    return new Response(request.method === "HEAD" ? null : text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }
  return response;
}

function normalizeJson(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeJson(item));
  if (value !== null && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(
        ([childKey, child]) => [childKey, normalizeJson(child, childKey)],
      ),
    );
  }
  if (typeof value === "string") {
    if (
      (value === "0.002" || value === "0.04") &&
      ["amount", "feeUsd", "price", "settlementFeeUsd", "amountUsd"].includes(
        key,
      )
    )
      return XGUARD_FINALIZED_FEE_USD;
    if (
      value === "successful_billable_settlement" ||
      value === "accepted_authenticated_economic_attempt"
    )
      return "finalized_successful_settlement";
    return normalizeText(value);
  }
  return value;
}

function normalizeText(value: string): string {
  return value
    .replaceAll("$0.04", `$${XGUARD_FINALIZED_FEE_USD}`)
    .replaceAll("$0.002", `$${XGUARD_FINALIZED_FEE_USD}`)
    .replaceAll("0.04 USD", `${XGUARD_FINALIZED_FEE_USD} USD`)
    .replaceAll("0.002 USD", `${XGUARD_FINALIZED_FEE_USD} USD`)
    .replaceAll(
      "accepted authenticated economic attempt",
      "independently finalized successful settlement",
    )
    .replaceAll(
      "successful billable settlement",
      "independently finalized successful settlement",
    )
    .replaceAll("merchant_prepaid_service_balance", "zero_signup_postpaid")
    .replaceAll(
      "merchant_prepaid_nonrefundable_attempt_fee",
      "zero_signup_postpaid",
    );
}

function paymentPage(origin: string, env: PaymentEnv): string {
  const limit = microUsdToUsd(parseLimit(env.XGUARD_POSTPAID_LIMIT_MICRO_USD));
  const feeBps = parseFeeBps(env.XGUARD_FEE_BPS);
  const feeCap = microUsdToUsd(parseFeeCap(env.XGUARD_FEE_CAP_MICRO_USD));
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Payments</title><meta name="robots" content="index,follow"><style>body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:auto;padding:48px 24px;background:#07090d;color:#f5f7fb}a{color:#9fd0ff}pre,code{background:#11151d;border:1px solid #242b38;border-radius:8px}pre{padding:16px;overflow:auto}.price{font-size:44px;font-weight:800}.card{padding:20px;border:1px solid #242b38;border-radius:14px;margin:18px 0}</style></head><body><h1>XGuard payment door</h1><div class="price">${feeBps / 100}%</div><p>of each independently finalized successful settlement, capped at $${feeCap}. Verify, failures and idempotent retries add no fee.</p><div class="card"><h2>Start</h2><p><strong>No account. No email. No API key. No prepaid balance.</strong></p><p>Sign once with the merchant <code>payTo</code> wallet, then use:</p><pre>const facilitator = new HTTPFacilitatorClient({ url: "${origin}" });</pre><p>Service only pauses when unpaid XGuard fees reach $${limit}.</p><a href="/start">Connect wallet & activate once</a></div><div class="card"><h2>Machine / Agent</h2><pre>GET ${origin}/.well-known/payment-manifest</pre><p>The JSON response contains the exact no-auth execution and fee endpoints.</p></div></body></html>`;
}

function parseFeeBps(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value))
    return XGUARD_FINALIZED_FEE_BPS;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 && parsed <= 10_000
    ? parsed
    : XGUARD_FINALIZED_FEE_BPS;
}

function parseFeeCap(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value))
    return XGUARD_FINALIZED_FEE_MICRO_USD;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0
    ? parsed
    : XGUARD_FINALIZED_FEE_MICRO_USD;
}

function parseLimit(value: string | undefined): number {
  if (value === undefined || !/^[0-9]+$/.test(value)) return 1_000_000;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : 1_000_000;
}

function microUsdToUsd(value: number): string {
  const whole = Math.floor(value / 1_000_000);
  const fraction = String(value % 1_000_000)
    .padStart(6, "0")
    .replace(/0+$/, "");
  return fraction.length === 0 ? `${whole}.00` : `${whole}.${fraction}`;
}

function json(request: Request, value: unknown): Response {
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(value),
    {
      headers: {
        "Access-Control-Allow-Origin": "*",
        "Cache-Control": "public, max-age=300",
        "Content-Type": "application/json; charset=utf-8",
        "X-Content-Type-Options": "nosniff",
        "X-XGuard-Pricing-Contract": "postpaid-finality-v2",
      },
    },
  );
}

function html(request: Request, value: string): Response {
  return new Response(request.method === "HEAD" ? null : value, {
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy":
        "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
    },
  });
}
