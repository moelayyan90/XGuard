import app from "./index.js";

const ORIGIN = "https://reconcile.xguardgate.com";
const NETWORK = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";

function json(body, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=120",
      "x-content-type-options": "nosniff"
    }
  });
}

function openapi() {
  return {
    openapi: "3.1.0",
    info: {
      title: "XGuard Reconcile API",
      version: "1.1.0",
      description: "Paid post-timeout reconciliation for Base x402 EIP-3009 USDC settlements.",
      "x-guidance": "Call GET /v1/reconcile with the EVM payer address in 'from' and the bytes32 EIP-3009 authorization nonce in 'nonce' after an x402 settlement attempt times out or returns an ambiguous server error. The endpoint charges $0.002 USDC on Base through x402 and reports whether the authorization was consumed and the transaction hash when observed. Do not retry the same authorization when authorization_used is true."
    },
    servers: [{ url: ORIGIN }],
    tags: [{ name: "Settlement Reliability", description: "Resolve ambiguous x402 payment state after facilitator failures." }],
    paths: {
      "/v1/reconcile": {
        get: {
          operationId: "reconcileX402Settlement",
          summary: "Resolve an ambiguous Base x402 settlement",
          description: "Checks native Base USDC EIP-3009 authorization state and recent AuthorizationUsed events after a facilitator timeout.",
          tags: ["Settlement Reliability"],
          parameters: [
            {
              name: "from",
              in: "query",
              required: true,
              description: "EVM address that signed the EIP-3009 authorization.",
              schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              example: "0x0000000000000000000000000000000000000001"
            },
            {
              name: "nonce",
              in: "query",
              required: true,
              description: "bytes32 EIP-3009 authorization nonce.",
              schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" },
              example: "0x0000000000000000000000000000000000000000000000000000000000000001"
            }
          ],
          "x-payment-info": {
            price: { mode: "fixed", currency: "USD", amount: "0.002000" },
            protocols: [{ x402: {} }]
          },
          responses: {
            "200": {
              description: "Reconciliation result",
              content: {
                "application/json": {
                  schema: {
                    type: "object",
                    properties: {
                      network: { type: "string" },
                      asset: { type: "string" },
                      authorizer: { type: "string" },
                      nonce: { type: "string" },
                      authorization_used: { type: "boolean" },
                      settlement: { type: "string" },
                      transaction: { type: ["string", "null"] },
                      safe_to_retry_same_authorization: { type: "boolean" }
                    },
                    required: ["network", "asset", "authorizer", "nonce", "authorization_used", "settlement", "safe_to_retry_same_authorization"]
                  }
                }
              }
            },
            "400": { description: "Invalid address or nonce" },
            "402": { description: "Payment Required" },
            "503": { description: "Base RPC unavailable" }
          }
        }
      }
    },
    "x-discovery": {
      resources: [`${ORIGIN}/v1/reconcile`]
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/openapi.json" && request.method === "GET") return json(openapi());
    if (url.pathname === "/.well-known/x402" && request.method === "GET") {
      return json({
        version: 1,
        resources: [`${ORIGIN}/v1/reconcile`],
        instructions: "Use GET /v1/reconcile?from=<EVM_ADDRESS>&nonce=<BYTES32>. Price: $0.002 USDC on Base via x402. Canonical schema: /openapi.json"
      });
    }
    return app.fetch(request, env, ctx);
  }
};
