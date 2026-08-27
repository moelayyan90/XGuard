import { Hono } from "hono";
import { paymentMiddleware, x402ResourceServer } from "@x402/hono";
import { HTTPFacilitatorClient } from "@x402/core/server";
import { registerExactEvmScheme as registerServerEvmScheme } from "@x402/evm/exact/server";
import { declareDiscoveryExtension, bazaarResourceServerExtension, withBazaar } from "@x402/extensions/bazaar";
import { createFacilitatorConfig } from "@coinbase/x402";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";

const VERSION = "1.2.0";
const NETWORK = "eip155:8453";
const PRICE = "$0.002";
const PRICE_ATOMIC = "2000";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const RESOURCE_URL = "https://reconcile.xguardgate.com/v1/reconcile";
const CDP_FACILITATOR = "https://api.cdp.coinbase.com/platform/v2/x402";
const FALLBACK_FACILITATOR = "https://facilitator.xpay.sh";
const DESCRIPTION = "Resolve an ambiguous Base x402 EIP-3009 settlement after a facilitator timeout. Returns whether the authorization nonce was consumed and, when observable, the settlement transaction hash.";
const TAGS = ["x402", "reconciliation", "base", "usdc", "eip-3009"];
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const AUTH_STATE = [{ type: "function", name: "authorizationState", stateMutability: "view", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] }];
const isAddress = value => /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
const isNonce = value => /^0x[0-9a-fA-F]{64}$/.test(String(value || ""));
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra } });

const discovery = declareDiscoveryExtension({
  input: {
    from: "0x1111111111111111111111111111111111111111",
    nonce: "0x1111111111111111111111111111111111111111111111111111111111111111"
  },
  inputSchema: {
    properties: {
      from: { type: "string", description: "EVM authorizer address", pattern: "^0x[0-9a-fA-F]{40}$" },
      nonce: { type: "string", description: "EIP-3009 bytes32 authorization nonce", pattern: "^0x[0-9a-fA-F]{64}$" }
    },
    required: ["from", "nonce"]
  },
  output: {
    example: {
      network: NETWORK,
      authorization_used: true,
      settlement: "observed",
      transaction: "0x…",
      safe_to_retry_same_authorization: false
    }
  }
});

function facilitatorState(env) {
  const cdpId = String(env.CDP_API_KEY_ID || "").trim();
  const cdpSecret = String(env.CDP_API_KEY_SECRET || "").trim();
  if (cdpId && cdpSecret) {
    return { url: CDP_FACILITATOR, bazaarPublishReady: true, mode: "coinbase_cdp", cdpId, cdpSecret };
  }
  return {
    url: String(env.X402_FACILITATOR || FALLBACK_FACILITATOR),
    bazaarPublishReady: false,
    mode: "fallback",
    cdpId: "",
    cdpSecret: ""
  };
}

function makeFacilitatorClient(env) {
  const state = facilitatorState(env);
  if (state.bazaarPublishReady) {
    return withBazaar(new HTTPFacilitatorClient(createFacilitatorConfig(state.cdpId, state.cdpSecret)));
  }
  return withBazaar(new HTTPFacilitatorClient({ url: state.url }));
}

function appFor(env) {
  const app = new Hono();
  const payTo = String(env.XGUARD_TREASURY_USDC_ADDRESS || "");
  if (!isAddress(payTo)) throw new Error("invalid_treasury_address");

  app.use("/v1/reconcile", async (c, next) => {
    if (c.req.method !== "GET") return next();
    const authorizer = String(c.req.query("from") || c.req.query("authorizer") || "");
    const nonce = String(c.req.query("nonce") || "");
    if (!isAddress(authorizer) || !isNonce(nonce)) {
      return json({ error: "invalid_input", required: { from: "0x + 40 hex EVM address", nonce: "0x + 64 hex bytes32" } }, 400);
    }
    return next();
  });

  const server = new x402ResourceServer(makeFacilitatorClient(env));
  registerServerEvmScheme(server);
  server.registerExtension(bazaarResourceServerExtension);
  app.use(paymentMiddleware({
    "GET /v1/reconcile": {
      accepts: [{ scheme: "exact", price: PRICE, network: NETWORK, payTo }],
      resource: RESOURCE_URL,
      description: DESCRIPTION,
      mimeType: "application/json",
      serviceName: "XGuard Reconcile",
      tags: TAGS,
      extensions: discovery
    }
  }, server));

  app.get("/v1/reconcile", async c => {
    const authorizer = String(c.req.query("from") || c.req.query("authorizer") || "");
    const nonce = String(c.req.query("nonce") || "");
    const client = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", { timeout: 6000, retryCount: 1 }) });
    try {
      const used = await client.readContract({ address: BASE_USDC, abi: AUTH_STATE, functionName: "authorizationState", args: [authorizer, nonce] });
      if (!used) return json({ network: NETWORK, asset: BASE_USDC, authorizer, nonce, authorization_used: false, settlement: "not_observed", safe_to_retry_same_authorization: true });
      const latest = await client.getBlockNumber();
      const fromBlock = latest > 3000n ? latest - 3000n : 0n;
      const logs = await client.getLogs({ address: BASE_USDC, event: AUTH_USED, args: { authorizer, nonce }, fromBlock, toBlock: latest });
      const tx = logs.length ? logs[logs.length - 1].transactionHash : null;
      return json({ network: NETWORK, asset: BASE_USDC, authorizer, nonce, authorization_used: true, settlement: tx ? "observed" : "nonce_consumed_tx_not_found_in_window", transaction: tx, safe_to_retry_same_authorization: false, searched_from_block: fromBlock.toString(), searched_to_block: latest.toString() });
    } catch (error) {
      return json({ error: "base_rpc_unavailable", detail: String(error?.shortMessage || error?.message || "rpc_error") }, 503);
    }
  });
  return app;
}

let cached = null;
let cacheKey = "";
function getApp(env) {
  const state = facilitatorState(env);
  const key = `${env.XGUARD_TREASURY_USDC_ADDRESS}|${state.url}|${state.mode}|${state.cdpId}`;
  if (cached && cacheKey === key) return cached;
  cached = appFor(env);
  cacheKey = key;
  return cached;
}

function landing() {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Reconcile — x402 timeout recovery</title><meta name="description" content="Resolve ambiguous Base x402 settlements after facilitator timeouts using EIP-3009 authorization state and on-chain events."><style>body{margin:0;background:#080b10;color:#f3f6fb;font:16px/1.55 system-ui,sans-serif}.w{max-width:900px;margin:auto;padding:40px}.hero{padding:70px 0}h1{font-size:clamp(44px,8vw,78px);line-height:.98;letter-spacing:-.05em;margin:12px 0 22px}.muted{color:#9aa7b8}.tag,pre{font-family:ui-monospace,monospace}.tag{color:#6ee7c7}pre{background:#05070a;border:1px solid #263143;border-radius:14px;padding:18px;overflow:auto}a{color:#dce8ff}</style></head><body><main class="w"><section class="hero"><div class="tag">x402 · Base mainnet · $0.002/call</div><h1>Did the settlement happen after the timeout?</h1><p class="muted">XGuard checks native Base USDC EIP-3009 authorization state and the AuthorizationUsed event. It never needs a private key and never touches merchant or buyer funds.</p></section><h2>Paid endpoint</h2><pre>GET ${RESOURCE_URL}?from=0x...&nonce=0x...\n\nHTTP 402 → pay $0.002 USDC on Base → retry with PAYMENT-SIGNATURE → JSON result</pre><p><a href="/docs">Machine-readable docs</a> · <a href="/openapi.json">OpenAPI</a> · <a href="/.well-known/x402.json">x402 discovery</a> · <a href="/llms.txt">llms.txt</a> · <a href="https://xguardgate.com">XGuard Relay</a></p></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'", "x-frame-options": "DENY", "x-content-type-options": "nosniff" } });
}

function docs(env) {
  const state = facilitatorState(env);
  return { name: "XGuard Reconcile", version: VERSION, description: "Post-timeout settlement reconciliation for Base x402 EIP-3009 payments.", endpoint: `GET ${RESOURCE_URL}?from=<EVM_ADDRESS>&nonce=<BYTES32>`, price_usd: 0.002, network: NETWORK, asset: BASE_USDC, scheme: "exact", facilitator: state.url, facilitator_mode: state.mode, bazaar_publish_ready: state.bazaarPublishReady, non_custodial: true, website: "https://xguardgate.com", llms: "https://reconcile.xguardgate.com/llms.txt", openapi: "https://reconcile.xguardgate.com/openapi.json" };
}

function discoveryDocument(env) {
  const payTo = String(env.XGUARD_TREASURY_USDC_ADDRESS || "");
  return {
    x402Version: 2,
    service: docs(env),
    resources: [{
      resource: RESOURCE_URL,
      type: "http",
      description: DESCRIPTION,
      serviceName: "XGuard Reconcile",
      tags: TAGS,
      accepts: [{ scheme: "exact", network: NETWORK, amount: PRICE_ATOMIC, asset: BASE_USDC, payTo }],
      extensions: {
        bazaar: {
          info: {
            input: {
              type: "http",
              method: "GET",
              queryParams: {
                from: "0x1111111111111111111111111111111111111111",
                nonce: "0x1111111111111111111111111111111111111111111111111111111111111111"
              }
            },
            output: {
              type: "json",
              example: {
                network: NETWORK,
                authorization_used: true,
                settlement: "observed",
                transaction: "0x…",
                safe_to_retry_same_authorization: false
              }
            }
          },
          schema: {
            properties: {
              from: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" },
              nonce: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" }
            },
            required: ["from", "nonce"]
          }
        }
      }
    }]
  };
}

function openapi() {
  return {
    openapi: "3.1.0",
    info: { title: "XGuard Reconcile", version: VERSION, description: "Resolve ambiguous x402 Base USDC settlements after facilitator timeouts." },
    servers: [{ url: "https://reconcile.xguardgate.com" }],
    paths: {
      "/v1/reconcile": {
        get: {
          summary: "Reconcile an ambiguous x402 settlement",
          description: "Checks Base USDC EIP-3009 authorization state and recent AuthorizationUsed logs.",
          parameters: [
            { name: "from", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{40}$" } },
            { name: "nonce", in: "query", required: true, schema: { type: "string", pattern: "^0x[0-9a-fA-F]{64}$" } }
          ],
          responses: {
            "200": { description: "Paid reconciliation result" },
            "402": { description: "x402 payment required" },
            "400": { description: "Invalid query parameters" },
            "503": { description: "Base RPC unavailable" }
          },
          "x-payment-info": { protocol: "x402", version: 2, scheme: "exact", network: NETWORK, price: PRICE, asset: "USDC", resource: RESOURCE_URL }
        }
      }
    }
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return landing();
    if (url.pathname === "/healthz" && request.method === "GET") {
      const state = facilitatorState(env);
      return json({ status: "ok", service: "XGuard Reconcile", version: VERSION, payment_ready: isAddress(env.XGUARD_TREASURY_USDC_ADDRESS), network: NETWORK, price: PRICE, facilitator: state.url, facilitator_mode: state.mode, bazaar_metadata: true, bazaar_publish_ready: state.bazaarPublishReady, openapi: true });
    }
    if (url.pathname === "/docs" && request.method === "GET") return json(docs(env));
    if (url.pathname === "/openapi.json" && request.method === "GET") return json(openapi());
    if ((url.pathname === "/.well-known/x402" || url.pathname === "/.well-known/x402.json") && request.method === "GET") return json(discoveryDocument(env));
    if (url.pathname === "/robots.txt" && request.method === "GET") return new Response("User-agent: *\nAllow: /\nSitemap: https://reconcile.xguardgate.com/sitemap.xml\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    if (url.pathname === "/sitemap.xml" && request.method === "GET") return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://reconcile.xguardgate.com/</loc></url><url><loc>https://reconcile.xguardgate.com/docs</loc></url><url><loc>https://reconcile.xguardgate.com/openapi.json</loc></url><url><loc>https://reconcile.xguardgate.com/.well-known/x402.json</loc></url></urlset>`, { headers: { "content-type": "application/xml; charset=utf-8" } });
    if (url.pathname === "/llms.txt" && request.method === "GET") return new Response(`XGuard Reconcile\nPost-timeout x402 settlement reconciliation on Base mainnet.\nPaid endpoint: GET ${RESOURCE_URL}?from=<EVM_ADDRESS>&nonce=<BYTES32>\nPrice: $0.002 USDC via x402 exact on eip155:8453.\nReturns EIP-3009 authorization state and transaction hash when observed.\nOpenAPI: https://reconcile.xguardgate.com/openapi.json\nx402 discovery: https://reconcile.xguardgate.com/.well-known/x402.json\nMain relay: https://xguardgate.com/api\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=120" } });
    return getApp(env).fetch(request, env, ctx);
  }
};
