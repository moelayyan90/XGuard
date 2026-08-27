import app from "./index.js";

const NETWORK = "eip155:8453";
const ASSET = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const AMOUNT = "2000";
const EXAMPLE_FROM = "0x1111111111111111111111111111111111111111";
const EXAMPLE_NONCE = "0x1111111111111111111111111111111111111111111111111111111111111111";
const RESOURCE = "https://reconcile.xguardgate.com/v1/reconcile";

function encode(value) {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

export function bareChallenge(env) {
  const payTo = String(env.XGUARD_TREASURY_USDC_ADDRESS || "");
  if (!/^0x[0-9a-fA-F]{40}$/.test(payTo) || /^0x0{40}$/i.test(payTo)) {
    return new Response(JSON.stringify({ error: "payment_not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
    });
  }

  const exampleUrl = `${RESOURCE}?from=${EXAMPLE_FROM}&nonce=${EXAMPLE_NONCE}`;
  const body = {
    x402Version: 2,
    error: "Query parameters are required. Use the example resource URL in this challenge.",
    resource: {
      url: exampleUrl,
      description: "Resolve an ambiguous Base USDC EIP-3009 settlement after a facilitator timeout.",
      mimeType: "application/json",
      serviceName: "XGuard Reconcile",
    },
    accepts: [{
      scheme: "exact",
      network: NETWORK,
      amount: AMOUNT,
      asset: ASSET,
      payTo,
      maxTimeoutSeconds: 60,
      extra: { name: "USD Coin", version: "2" },
    }],
    extensions: {},
  };

  return new Response(JSON.stringify(body), {
    status: 402,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "payment-required": encode(body),
      "x-xguard-monitor-discovery": "bare-x402-challenge",
      "link": `<${exampleUrl}>; rel="alternate"`,
    },
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/v1/reconcile" && request.method === "GET") {
      const hasInput = Boolean(url.searchParams.get("from") || url.searchParams.get("authorizer") || url.searchParams.get("nonce"));
      if (!hasInput) {
        // A signed retry against the bare URL is never settled. This prevents a
        // crawler-friendly challenge from charging a client for dummy/example input.
        if (request.headers.has("payment-signature")) {
          return new Response(JSON.stringify({
            error: "input_required_before_payment",
            required: ["from", "nonce"],
            example: `${RESOURCE}?from=${EXAMPLE_FROM}&nonce=${EXAMPLE_NONCE}`,
          }), {
            status: 400,
            headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
          });
        }
        return bareChallenge(env);
      }
    }
    return app.fetch(request, env, ctx);
  },
};
