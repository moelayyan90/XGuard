import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";

const VERSION = "2.0.0";
const BASE_CAIP = "eip155:8453";
const BASE_LEGACY = "base";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHECKOUT_FALLBACK = "https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab";
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const AUTH_STATE = [{ type: "function", name: "authorizationState", stateMutability: "view", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] }];
const circuit = new Map();

const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...extra }
});

const cleanBase = value => String(value || "").replace(/\/$/, "");
const isAddress = value => /^0x[0-9a-fA-F]{40}$/.test(String(value || ""));
const isNonce = value => /^0x[0-9a-fA-F]{64}$/.test(String(value || ""));
const isBase = network => network === BASE_CAIP || network === BASE_LEGACY;
const isSolana = network => String(network || "").startsWith("solana:") || network === "solana";
const now = () => Date.now();

function bearer(request) {
  const auth = (request.headers.get("authorization") || "").trim();
  if (/^Bearer\s+/i.test(auth)) return auth.replace(/^Bearer\s+/i, "").trim();
  return (request.headers.get("x-xguard-key") || "").trim();
}

async function bodyJson(request) {
  const length = Number(request.headers.get("content-length") || 0);
  if (length > 131072) throw Object.assign(new Error("body_too_large"), { status: 413 });
  const text = await request.text();
  if (text.length > 131072) throw Object.assign(new Error("body_too_large"), { status: 413 });
  try { return { parsed: JSON.parse(text), raw: text }; }
  catch { throw Object.assign(new Error("invalid_json"), { status: 400 }); }
}

function paymentIdentity(body) {
  const requirements = body?.paymentRequirements || body?.requirements || body?.payment?.paymentRequirements || null;
  const payload = body?.paymentPayload || body?.payment || body?.payload || null;
  const accepted = payload?.accepted || requirements || null;
  const authorization = payload?.payload?.authorization || payload?.authorization || null;
  const network = requirements?.network || accepted?.network || "";
  return {
    network,
    scheme: requirements?.scheme || accepted?.scheme || "",
    asset: requirements?.asset || accepted?.asset || "",
    payTo: requirements?.payTo || accepted?.payTo || "",
    amount: requirements?.amount || requirements?.maxAmountRequired || accepted?.amount || accepted?.maxAmountRequired || "",
    from: authorization?.from || "",
    nonce: authorization?.nonce || ""
  };
}

function upstreams(env, network) {
  const xpay = cleanBase(env.X402_BASE_PRIMARY || "https://facilitator.xpay.sh");
  const open = cleanBase(env.X402_BASE_SECONDARY || "https://facilitator.openx402.ai");
  const dexter = cleanBase(env.X402_MULTI || "https://x402.dexter.cash");
  const list = isBase(network) ? [xpay, open, dexter] : isSolana(network) ? [open, dexter] : [dexter, open];
  return [...new Set(list)].sort((a, b) => (circuit.get(a)?.disabledUntil || 0) - (circuit.get(b)?.disabledUntil || 0));
}

function note(url, ok, latency) {
  const prior = circuit.get(url) || { failures: 0, latency: 9999, disabledUntil: 0 };
  if (ok) circuit.set(url, { failures: 0, latency, disabledUntil: 0 });
  else {
    const failures = prior.failures + 1;
    circuit.set(url, { failures, latency: prior.latency, disabledUntil: failures >= 2 ? now() + Math.min(60000, failures * 10000) : 0 });
  }
}

async function callUpstream(url, operation, raw, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const started = performance.now();
  try {
    const response = await fetch(`${url}/${operation}`, {
      method: "POST",
      headers: { "content-type": "application/json", "accept": "application/json", "user-agent": `XGuard-Relay/${VERSION}` },
      body: raw,
      redirect: "manual",
      signal: controller.signal
    });
    const text = await response.text();
    let data = null; try { data = JSON.parse(text); } catch {}
    const okTransport = response.status < 500;
    note(url, okTransport, Math.round(performance.now() - started));
    return { url, status: response.status, text, data, retryable: response.status >= 500, transportError: false };
  } catch (error) {
    note(url, false, Math.round(performance.now() - started));
    return { url, status: 0, text: "", data: null, retryable: true, transportError: true, error: error?.name === "AbortError" ? "timeout" : "network_error" };
  } finally { clearTimeout(timer); }
}

function settleSucceeded(result) {
  if (!result || result.status < 200 || result.status >= 300) return false;
  if (result.data && typeof result.data.success === "boolean") return result.data.success;
  if (result.data && typeof result.data.settled === "boolean") return result.data.settled;
  return false;
}

function relayResponse(result, route, recovered = false) {
  const headers = { "x-xguard-upstream": new URL(route).hostname, "x-xguard-recovered": recovered ? "1" : "0" };
  if (result.text) return new Response(result.text, { status: result.status || 502, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
  return json({ error: result.error || "upstream_unavailable" }, result.status || 502, headers);
}

async function billingBalance(env, key) {
  const response = await fetch(`${cleanBase(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com")}/v1/balance`, {
    headers: { authorization: `Bearer ${key}`, "user-agent": `XGuard-Relay/${VERSION}` }
  });
  let data = {}; try { data = await response.json(); } catch {}
  return { ok: response.ok, status: response.status, credits: Number(data.credits || 0), data };
}

async function billingConsume(env, key, units) {
  const response = await fetch(`${cleanBase(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com")}/v1/consume`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "user-agent": `XGuard-Relay/${VERSION}` },
    body: JSON.stringify({ units })
  });
  let data = {}; try { data = await response.json(); } catch {}
  return { ok: response.ok, status: response.status, data };
}

async function quota(env, payTo, action, nonce = "") {
  const id = env.QUOTAS.idFromName(String(payTo).toLowerCase());
  const stub = env.QUOTAS.get(id);
  const response = await stub.fetch(`https://quota/${action}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce, limit: Number(env.FREE_SETTLEMENTS || 25) }) });
  return { status: response.status, data: await response.json() };
}

async function recoverBase(env, identity) {
  if (!isAddress(identity.from) || !isNonce(identity.nonce)) return null;
  const client = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", { timeout: 5000, retryCount: 1 }) });
  try {
    const used = await client.readContract({ address: BASE_USDC, abi: AUTH_STATE, functionName: "authorizationState", args: [identity.from, identity.nonce] });
    if (!used) return { used: false };
    const latest = await client.getBlockNumber();
    const fromBlock = latest > 1500n ? latest - 1500n : 0n;
    const logs = await client.getLogs({ address: BASE_USDC, event: AUTH_USED, args: { authorizer: identity.from, nonce: identity.nonce }, fromBlock, toBlock: latest });
    if (!logs.length) return { used: true, ambiguous: true };
    return { used: true, transaction: logs[logs.length - 1].transactionHash };
  } catch { return null; }
}

async function doVerify(request, env) {
  const { parsed, raw } = await bodyJson(request);
  const identity = paymentIdentity(parsed);
  const routes = upstreams(env, identity.network);
  let last = null;
  for (const route of routes) {
    const result = await callUpstream(route, "verify", raw, 5000);
    last = result;
    if (!result.retryable) return relayResponse(result, route);
  }
  return relayResponse(last || { status: 503, error: "no_upstream" }, last?.url || routes[0]);
}

async function doSettle(request, env) {
  const { parsed, raw } = await bodyJson(request);
  const identity = paymentIdentity(parsed);
  if (!identity.payTo) return json({ error: "missing_pay_to" }, 400);
  const key = bearer(request);
  const feeUnits = Math.max(1, Number(env.SETTLEMENT_CREDITS || 2));
  let freeAdmission = null;

  if (key) {
    const balance = await billingBalance(env, key);
    if (!balance.ok) return json({ error: balance.status === 404 ? "unknown_xguard_license" : "billing_unavailable", checkout_url: env.XGUARD_CHECKOUT_URL || CHECKOUT_FALLBACK }, balance.status === 404 ? 401 : 503);
    if (balance.credits < feeUnits) return json({ error: "insufficient_xguard_credits", credits: balance.credits, required: feeUnits, checkout_url: env.XGUARD_CHECKOUT_URL || CHECKOUT_FALLBACK }, 402);
  } else {
    freeAdmission = await quota(env, identity.payTo, "admit", identity.nonce || crypto.randomUUID());
    if (freeAdmission.status !== 200) return json({ error: "xguard_credits_required", free_settlements_used: freeAdmission.data.success || Number(env.FREE_SETTLEMENTS || 25), checkout_url: env.XGUARD_CHECKOUT_URL || CHECKOUT_FALLBACK, authentication: "Authorization: Bearer <Lemon Squeezy license key>" }, 402);
  }

  const routes = upstreams(env, identity.network);
  let final = null;
  let recovered = false;
  let chosen = routes[0];

  for (let i = 0; i < routes.length; i++) {
    const route = routes[i];
    chosen = route;
    const result = await callUpstream(route, "settle", raw, 10000);
    final = result;
    if (!result.retryable) break;

    if (isBase(identity.network)) {
      const recovery = await recoverBase(env, identity);
      if (recovery?.transaction) {
        final = { status: 200, text: JSON.stringify({ success: true, payer: identity.from, transaction: recovery.transaction, network: identity.network || BASE_CAIP }), data: { success: true, payer: identity.from, transaction: recovery.transaction, network: identity.network || BASE_CAIP }, retryable: false };
        recovered = true;
        break;
      }
      if (recovery?.used) {
        final = { status: 503, text: JSON.stringify({ success: false, errorReason: "settlement_state_ambiguous_nonce_used", network: identity.network || BASE_CAIP }), data: null, retryable: false };
        break;
      }
      if (recovery && recovery.used === false) continue;
      break;
    }
    break;
  }

  if (settleSucceeded(final)) {
    if (key) {
      const consumed = await billingConsume(env, key, feeUnits);
      if (!consumed.ok) console.error(JSON.stringify({ event: "billing_post_settlement_failure", status: consumed.status, payTo: identity.payTo, upstream: chosen }));
    } else if (freeAdmission) {
      await quota(env, identity.payTo, "commit", identity.nonce || freeAdmission.data.nonce || "");
    }
    console.log(JSON.stringify({ event: "settlement_success", network: identity.network, upstream: chosen, recovered, billed_credits: key ? feeUnits : 0, free: !key }));
  } else if (!key && freeAdmission) {
    await quota(env, identity.payTo, "release", identity.nonce || freeAdmission.data.nonce || "");
  }

  return relayResponse(final || { status: 503, error: "settlement_unavailable" }, chosen, recovered);
}

async function proxySupported(env) {
  const candidates = [cleanBase(env.X402_BASE_SECONDARY || "https://facilitator.openx402.ai"), cleanBase(env.X402_MULTI || "https://x402.dexter.cash"), cleanBase(env.X402_BASE_PRIMARY || "https://facilitator.xpay.sh")];
  for (const url of candidates) {
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 3500);
      const response = await fetch(`${url}/supported`, { headers: { accept: "application/json", "user-agent": `XGuard-Relay/${VERSION}` }, signal: controller.signal });
      clearTimeout(timer);
      if (response.ok) return new Response(await response.text(), { status: 200, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=30", "x-xguard-supported-source": new URL(url).hostname } });
    } catch {}
  }
  return json({ kinds: [], extensions: [], signers: {} }, 503);
}

async function health(env) {
  const urls = [...new Set([env.X402_BASE_PRIMARY || "https://facilitator.xpay.sh", env.X402_BASE_SECONDARY || "https://facilitator.openx402.ai", env.X402_MULTI || "https://x402.dexter.cash"].map(cleanBase))];
  const checks = await Promise.all(urls.map(async url => {
    const started = performance.now();
    try {
      const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 2500);
      const r = await fetch(`${url}/supported`, { headers: { accept: "application/json" }, signal: controller.signal }); clearTimeout(timer);
      return { host: new URL(url).hostname, ok: r.ok, status: r.status, latency_ms: Math.round(performance.now() - started) };
    } catch { return { host: new URL(url).hostname, ok: false, status: 0, latency_ms: Math.round(performance.now() - started) }; }
  }));
  return { status: checks.some(x => x.ok) ? "ok" : "degraded", service: "XGuard Relay", version: VERSION, non_custodial: true, verify_price_credits: 0, settlement_price_credits: Number(env.SETTLEMENT_CREDITS || 2), free_successful_settlements_per_merchant: Number(env.FREE_SETTLEMENTS || 25), upstreams: checks };
}

function landing(env) {
  const checkout = env.XGUARD_CHECKOUT_URL || CHECKOUT_FALLBACK;
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Relay — x402 settlement reliability</title><meta name="description" content="Non-custodial x402 facilitator routing with health-aware selection and Base timeout recovery."><style>body{margin:0;background:#07090d;color:#f5f7fb;font:16px/1.55 system-ui,sans-serif}.w{max-width:980px;margin:auto;padding:34px}.tag,code{font-family:ui-monospace,monospace}.tag{color:#6ee7c7}.hero{padding:70px 0 42px}h1{font-size:clamp(46px,8vw,82px);line-height:.95;letter-spacing:-.055em;margin:14px 0 24px}.sub{font-size:20px;color:#aab3c2;max-width:760px}.g{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin:36px 0}.c{border:1px solid #273141;border-radius:16px;padding:21px;background:#0e131b}.c b{display:block;font-size:24px;margin-bottom:7px}.muted{color:#929dac}.btn{display:inline-block;background:#f6f7fb;color:#080b10;padding:13px 17px;border-radius:10px;text-decoration:none;font-weight:800;margin-right:8px}pre{background:#05070a;border:1px solid #273141;border-radius:14px;padding:18px;overflow:auto;color:#dce3ee}footer{border-top:1px solid #273141;margin-top:60px;padding:26px 0;color:#748092}@media(max-width:720px){.g{grid-template-columns:1fr}}</style></head><body><main class="w"><section class="hero"><div class="tag">x402 · production relay</div><h1>One facilitator URL. Multiple settlement paths.</h1><p class="sub">XGuard sits between an x402 resource server and production facilitators. It selects a live route, fails over verification, and on Base checks EIP-3009 authorization state before retrying an ambiguous settlement. Buyer funds still move directly to the merchant.</p><p><a class="btn" href="${checkout}">Buy XGuard Usage Credits</a><a class="btn" href="/docs">Integration</a></p></section><div class="g"><div class="c"><b>$0</b><span class="muted">verification calls</span></div><div class="c"><b>25</b><span class="muted">successful settlements free per merchant</span></div><div class="c"><b>2 credits</b><span class="muted">per successful paid settlement; failed calls are not charged</span></div></div><section><h2>Drop-in endpoint</h2><pre>Facilitator URL: https://api.xguardgate.com

POST /verify   — free
POST /settle   — health-aware routing + recovery
GET  /supported

Authorization: Bearer YOUR_XGUARD_LICENSE_KEY</pre><p class="muted">No custody. No private keys. XGuard does not alter the signed amount or recipient.</p></section><footer>XGuard Relay · Base + multi-chain routing · Cloudflare Workers</footer></main></body></html>`, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=120", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action https://lfsystems.lemonsqueezy.com", "x-frame-options": "DENY", "x-content-type-options": "nosniff" } });
}

function docs(env) {
  return json({
    name: "XGuard Relay",
    version: VERSION,
    facilitator_url: "https://api.xguardgate.com",
    endpoints: { supported: "GET /supported", verify: "POST /verify", settle: "POST /settle", health: "GET /healthz", balance: "GET /v1/balance" },
    pricing: { verify_credits: 0, free_successful_settlements_per_payTo: Number(env.FREE_SETTLEMENTS || 25), credits_per_successful_paid_settlement: Number(env.SETTLEMENT_CREDITS || 2), failed_settlements_charged: false, checkout: env.XGUARD_CHECKOUT_URL || CHECKOUT_FALLBACK },
    auth: { paid_settle_header: "Authorization: Bearer <XGuard Usage Credits license key>" },
    custody: "none",
    behavior: { verify_failover: true, base_timeout_reconciliation: true, blind_retry_after_ambiguous_base_settlement: false }
  });
}

export class MerchantQuota {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    const body = await request.json().catch(() => ({}));
    const nonce = String(body.nonce || "");
    const limit = Math.max(0, Number(body.limit || 25));
    const state = (await this.ctx.storage.get("state")) || { success: 0, pending: {} };
    const cutoff = Date.now() - 120000;
    for (const [key, ts] of Object.entries(state.pending || {})) if (Number(ts) < cutoff) delete state.pending[key];
    if (path === "/admit") {
      if (state.success + Object.keys(state.pending).length >= limit) return json({ error: "free_quota_exhausted", success: state.success }, 402);
      const id = nonce || crypto.randomUUID(); state.pending[id] = Date.now(); await this.ctx.storage.put("state", state); return json({ ok: true, nonce: id, success: state.success });
    }
    if (path === "/commit") {
      if (nonce && state.pending[nonce]) { delete state.pending[nonce]; state.success += 1; await this.ctx.storage.put("state", state); }
      return json({ ok: true, success: state.success });
    }
    if (path === "/release") {
      if (nonce && state.pending[nonce]) { delete state.pending[nonce]; await this.ctx.storage.put("state", state); }
      return json({ ok: true, success: state.success });
    }
    return json({ error: "not_found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return landing(env);
      if (url.pathname === "/healthz" && request.method === "GET") return json(await health(env));
      if (url.pathname === "/supported" && request.method === "GET") return proxySupported(env);
      if (url.pathname === "/verify" && request.method === "POST") return doVerify(request, env);
      if (url.pathname === "/settle" && request.method === "POST") return doSettle(request, env);
      if (url.pathname === "/docs" && request.method === "GET") return docs(env);
      if (url.pathname === "/v1/balance" && request.method === "GET") {
        const key = bearer(request); if (!key) return json({ error: "missing_xguard_license" }, 401);
        const balance = await billingBalance(env, key); return json(balance.data, balance.status);
      }
      if (url.pathname === "/llms.txt" && request.method === "GET") return new Response("XGuard Relay\nFacilitator URL: https://api.xguardgate.com\nGET /supported\nPOST /verify\nPOST /settle\nDocs: https://api.xguardgate.com/docs\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (url.pathname === "/.well-known/x402" && request.method === "GET") return docs(env);
      return json({ error: "not_found" }, 404);
    } catch (error) {
      console.error(JSON.stringify({ event: "relay_error", error: String(error?.message || error) }));
      return json({ error: error?.message || "internal_error" }, Number(error?.status || 500));
    }
  }
};
