export const XGUARD_ATTEMPT_FEE_USD = "0.04";
export const XGUARD_ATTEMPT_FEE_MICRO_USD = 40_000;

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

type PaymentEnv = { XGUARD_TREASURY_USDC_ADDRESS?: string };

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
  return html(request, paymentPage(origin));
}

export function buildPaymentManifest(
  origin: string,
  env: PaymentEnv,
): Record<string, unknown> {
  return manifest(origin, env);
}

function manifest(origin: string, env: PaymentEnv): Record<string, unknown> {
  return {
    manifest: "xguard-payment-manifest-v1",
    name: "XGuard",
    mode: "production",
    network: "eip155:8453",
    asset: {
      symbol: "USDC",
      contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      ...(env.XGUARD_TREASURY_USDC_ADDRESS
        ? { treasury: env.XGUARD_TREASURY_USDC_ADDRESS }
        : {}),
    },
    pricing: {
      amountUsd: XGUARD_ATTEMPT_FEE_USD,
      amountMicroUsd: XGUARD_ATTEMPT_FEE_MICRO_USD,
      event: "accepted_authenticated_economic_attempt",
      billing: "merchant_prepaid_service_balance",
      refundableAfterAcceptance: false,
      dedupe:
        "one fee per logicalPaymentKey; idempotent retries add no second attempt fee",
    },
    onboarding: {
      human: `${origin}/pay`,
      register: `${origin}/v1/register`,
      balance: `${origin}/v1/balance`,
      topUpIntent: `${origin}/v1/topups/intents`,
      topUpClaim: `${origin}/v1/topups/claim`,
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
  headers.set("X-XGuard-Pricing-Contract", "attempt-v1");

  if (type.includes("application/json")) {
    try {
      const value = normalizeJson(await response.clone().json());
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "public, max-age=300");
      return new Response(request.method === "HEAD" ? null : JSON.stringify(value), {
        status: response.status,
        statusText: response.statusText,
        headers,
      });
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
      Object.entries(value as Record<string, unknown>).map(([childKey, child]) => [
        childKey,
        normalizeJson(child, childKey),
      ]),
    );
  }
  if (typeof value === "string") {
    if (
      value === "0.002" &&
      ["amount", "feeUsd", "price", "settlementFeeUsd", "amountUsd"].includes(
        key,
      )
    )
      return XGUARD_ATTEMPT_FEE_USD;
    if (value === "successful_billable_settlement")
      return "accepted_authenticated_economic_attempt";
    return normalizeText(value);
  }
  return value;
}

function normalizeText(value: string): string {
  return value
    .replaceAll("$0.002", `$${XGUARD_ATTEMPT_FEE_USD}`)
    .replaceAll("0.002 USD", `${XGUARD_ATTEMPT_FEE_USD} USD`)
    .replaceAll(
      "successful billable settlement",
      "accepted authenticated economic attempt",
    )
    .replaceAll(
      "per successful billable settlement",
      "per accepted authenticated economic attempt",
    );
}

function paymentPage(origin: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Payments</title><meta name="robots" content="index,follow"><style>body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:auto;padding:48px 24px;background:#07090d;color:#f5f7fb}a{color:#9fd0ff}pre,code{background:#11151d;border:1px solid #242b38;border-radius:8px}pre{padding:16px;overflow:auto}.price{font-size:44px;font-weight:800}.card{padding:20px;border:1px solid #242b38;border-radius:14px;margin:18px 0}</style></head><body><h1>XGuard payment door</h1><div class="price">$${XGUARD_ATTEMPT_FEE_USD}</div><p>per accepted authenticated x402 economic attempt. Idempotent retries add no second attempt fee.</p><div class="card"><h2>Human</h2><ol><li>Create an API key at <code>POST /v1/register</code>.</li><li>Create a top-up at <code>POST /v1/topups/intents</code>.</li><li>Claim it at <code>POST /v1/topups/claim</code>.</li><li>Use the key on <code>/verify</code> and <code>/settle</code>.</li></ol><a href="/docs">Open full docs</a></div><div class="card"><h2>Robot / Agent</h2><pre>GET ${origin}/.well-known/payment-manifest</pre><p>The JSON response contains onboarding, payment, A2A, MCP and OpenAPI endpoints.</p></div></body></html>`;
}

function json(request: Request, value: unknown): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value), {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-XGuard-Pricing-Contract": "attempt-v1",
    },
  });
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
