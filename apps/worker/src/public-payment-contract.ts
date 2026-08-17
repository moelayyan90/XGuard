export const XGUARD_ATTEMPT_FEE_USD = "0.04";
export const XGUARD_ATTEMPT_FEE_MICRO_USD = 40_000;

const PAYMENT_DISCOVERY_PATHS = new Set([
  "/.well-known/payment-manifest",
  "/.well-known/payment-manifest.json",
  "/.well-known/payments.json",
  "/.well-known/xguard/payments.json",
  "/payment-manifest",
  "/payments",
]);

const HUMAN_PAYMENT_PATHS = new Set(["/pay", "/payment", "/pricing"]);
const NORMALIZED_PUBLIC_PATHS = new Set([
  "/",
  "/docs",
  "/quickstart",
  "/llms.txt",
  "/llms-full.txt",
  "/provider.json",
  "/.well-known/x402.json",
  "/.well-known/x402/facilitator.json",
  "/.well-known/agent-card.json",
  "/.well-known/agent.json",
  "/.well-known/agent-market.json",
  "/.well-known/xguard.json",
]);

interface PaymentContractEnv {
  XGUARD_TREASURY_USDC_ADDRESS?: string;
}

export function publicPaymentContractResponse(
  request: Request,
  env: PaymentContractEnv,
): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);

  if (PAYMENT_DISCOVERY_PATHS.has(url.pathname)) {
    const body = buildPaymentManifest(url.origin, env);
    return publicJson(request, body);
  }

  if (HUMAN_PAYMENT_PATHS.has(url.pathname)) {
    const accept = request.headers.get("accept")?.toLowerCase() ?? "";
    if (accept.includes("application/json"))
      return publicJson(request, buildPaymentManifest(url.origin, env));
    return publicHtml(request, paymentPage(url.origin));
  }

  return null;
}

export function buildPaymentManifest(
  origin: string,
  env: PaymentContractEnv,
): Record<string, unknown> {
  const treasury = env.XGUARD_TREASURY_USDC_ADDRESS;
  return {
    manifest: "xguard-payment-manifest-v1",
    name: "XGuard",
    mode: "production",
    network: "eip155:8453",
    asset: {
      symbol: "USDC",
      contract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      ...(treasury === undefined ? {} : { treasury }),
    },
    pricing: {
      amountUsd: XGUARD_ATTEMPT_FEE_USD,
      amountMicroUsd: XGUARD_ATTEMPT_FEE_MICRO_USD,
      event: "accepted_authenticated_economic_attempt",
      billing: "merchant_prepaid_service_balance",
      refundableAfterAcceptance: false,
      dedupe: "one fee per logicalPaymentKey; idempotent retries add no second attempt fee",
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
    machineInstructions: [
      "GET this manifest without authentication.",
      "POST /v1/register once to obtain an XGuard merchant API key.",
      "Fund the prepaid service balance through /v1/topups/intents and /v1/topups/claim.",
      "Send the canonical x402 request to /verify or /settle with Authorization: Bearer <XGuard key>.",
      "Treat HTTP 402 as a request to fund the XGuard service balance, not as a successful settlement.",
    ],
  };
}

export async function normalizePublicPaymentContract(
  request: Request,
  response: Response,
): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return response;
  const path = new URL(request.url).pathname;
  if (!NORMALIZED_PUBLIC_PATHS.has(path) || !response.ok) return response;

  const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
  const headers = new Headers(response.headers);
  headers.delete("content-length");
  headers.delete("etag");
  headers.set("X-XGuard-Pricing-Contract", "attempt-v1");

  if (contentType.includes("application/json")) {
    try {
      const value = await response.clone().json();
      const normalized = normalizeJsonValue(value);
      headers.set("content-type", "application/json; charset=utf-8");
      headers.set("cache-control", "public, max-age=300");
      return new Response(
        request.method === "HEAD" ? null : JSON.stringify(normalized),
        { status: response.status, statusText: response.statusText, headers },
      );
    } catch {
      return response;
    }
  }

  if (contentType.includes("text/") || contentType.includes("text/html")) {
    let text = await response.text();
    text = normalizePricingText(text);
    headers.set("cache-control", "no-store");
    return new Response(request.method === "HEAD" ? null : text, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  }

  return response;
}

function normalizeJsonValue(value: unknown, key = ""): unknown {
  if (Array.isArray(value)) return value.map((item) => normalizeJsonValue(item));
  if (value !== null && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    ))
      output[childKey] = normalizeJsonValue(childValue, childKey);
    return output;
  }
  if (typeof value === "string") {
    if (
      value === "0.002" &&
      ["amount", "feeUsd", "price", "settlementFeeUsd", "amountUsd"].includes(key)
    )
      return XGUARD_ATTEMPT_FEE_USD;
    if (value === "successful_billable_settlement")
      return "accepted_authenticated_economic_attempt";
    return normalizePricingText(value);
  }
  if (
    typeof value === "number" &&
    value === 2000 &&
    ["feeMicroUsd", "settlementFeeMicroUsd", "paymentSettlementMicroUsd"].includes(
      key,
    )
  )
    return XGUARD_ATTEMPT_FEE_MICRO_USD;
  return value;
}

function normalizePricingText(value: string): string {
  return value
    .replaceAll("$0.002", `$${XGUARD_ATTEMPT_FEE_USD}`)
    .replaceAll("0.002 USD", `${XGUARD_ATTEMPT_FEE_USD} USD`)
    .replaceAll("successful billable settlement", "accepted authenticated economic attempt")
    .replaceAll("per successful billable settlement", "per accepted authenticated economic attempt")
    .replaceAll("successful settlement", "accepted economic attempt");
}

function paymentPage(origin: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard Payments</title>
<meta name="description" content="XGuard payment onboarding for humans and autonomous agents.">
<meta name="robots" content="index,follow">
<style>body{font:16px/1.55 system-ui,sans-serif;max-width:860px;margin:0 auto;padding:48px 24px;background:#07090d;color:#f5f7fb}a{color:#9fd0ff}code,pre{background:#11151d;border:1px solid #242b38;border-radius:10px}code{padding:2px 6px}pre{padding:18px;overflow:auto}.price{font-size:44px;font-weight:800;margin:12px 0}.muted{color:#aab3c2}.card{padding:22px;border:1px solid #242b38;border-radius:14px;margin:18px 0}h1,h2{line-height:1.15}</style>
</head>
<body>
<h1>XGuard payment door</h1>
<p class="muted">One clear path for humans and autonomous agents.</p>
<div class="price">$${XGUARD_ATTEMPT_FEE_USD}</div>
<p>per accepted authenticated x402 economic attempt. One logical payment key is charged once; an idempotent retry does not add a second attempt fee.</p>
<div class="card"><h2>Human</h2><ol><li>Create an API key with <code>POST /v1/register</code>.</li><li>Create a top-up intent with <code>POST /v1/topups/intents</code>.</li><li>Send the exact Base USDC amount and claim it with <code>POST /v1/topups/claim</code>.</li><li>Use the key on <code>/verify</code> and <code>/settle</code>.</li></ol><p><a href="/docs">Open full documentation</a></p></div>
<div class="card"><h2>Robot / Agent</h2><p>Start here:</p><pre>GET ${origin}/.well-known/payment-manifest</pre><p>The response contains onboarding, payment, A2A, MCP and OpenAPI endpoints in JSON.</p></div>
<div class="card"><h2>Register</h2><pre>curl -X POST ${origin}/v1/register \\
  -H 'content-type: application/json' \\
  -d '{"name":"my-agent"}'</pre></div>
</body></html>`;
}

function publicJson(request: Request, value: unknown): Response {
  return new Response(request.method === "HEAD" ? null : JSON.stringify(value), {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "public, max-age=300",
      "Content-Type": "application/json; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
      "X-XGuard-Pricing-Contract": "attempt-v1",
    },
  });
}

function publicHtml(request: Request, html: string): Response {
  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "Cache-Control": "public, max-age=300",
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'",
      "Content-Type": "text/html; charset=utf-8",
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XGuard-Pricing-Contract": "attempt-v1",
    },
  });
}
