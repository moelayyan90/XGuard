import relay from "./index.js";
import { createPublicClient, http, parseAbiItem } from "viem";
import { base } from "viem/chains";

const VERSION = "2.2.0";
const BASE_CAIP = "eip155:8453";
const BASE_USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const CHECKOUT = "https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab";
const RECONCILE = "https://reconcile.xguardgate.com";
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
const AUTH_STATE = [{ type: "function", name: "authorizationState", stateMutability: "view", inputs: [{ name: "authorizer", type: "address" }, { name: "nonce", type: "bytes32" }], outputs: [{ name: "", type: "bool" }] }];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
const sleep = ms => new Promise(r => setTimeout(r, ms));
const isAddress = x => /^0x[0-9a-fA-F]{40}$/.test(String(x || ""));
const isNonce = x => /^0x[0-9a-fA-F]{64}$/.test(String(x || ""));
const isHash = x => /^0x[0-9a-fA-F]{64}$/.test(String(x || ""));
const bearer = request => ((request.headers.get("authorization") || "").match(/^Bearer\s+(.+)$/i)?.[1] || request.headers.get("x-xguard-key") || "").trim();

function paymentIdentity(body) {
  const requirements = body?.paymentRequirements || body?.requirements || body?.payment?.paymentRequirements || null;
  const payload = body?.paymentPayload || body?.payment || body?.payload || null;
  const accepted = payload?.accepted || requirements || null;
  const authorization = payload?.payload?.authorization || payload?.authorization || null;
  return {
    network: requirements?.network || accepted?.network || "",
    asset: requirements?.asset || accepted?.asset || "",
    payTo: requirements?.payTo || accepted?.payTo || "",
    amount: requirements?.amount || requirements?.maxAmountRequired || accepted?.amount || accepted?.maxAmountRequired || "",
    from: authorization?.from || "",
    nonce: authorization?.nonce || ""
  };
}

async function hashText(value) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(value)));
  return [...new Uint8Array(d)].map(x => x.toString(16).padStart(2, "0")).join("");
}
async function receiptId(identity) {
  if (!identity.network || !identity.from || !identity.nonce) return "";
  return `xgr_${(await hashText(`${identity.network}|${identity.asset}|${identity.from.toLowerCase()}|${identity.nonce.toLowerCase()}`)).slice(0, 40)}`;
}
function receiptStub(env, id) { return env.RECEIPTS.get(env.RECEIPTS.idFromName(id)); }
async function getReceipt(env, id) {
  if (!id) return null;
  const r = await receiptStub(env, id).fetch("https://receipt/get");
  return r.ok ? r.json() : null;
}
async function putReceipt(env, id, record) {
  if (!id) return null;
  const r = await receiptStub(env, id).fetch("https://receipt/record", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(record) });
  return r.ok ? r.json() : null;
}

function txHashFrom(data, text = "") {
  const candidates = [data?.transaction, data?.transactionHash, data?.txHash, data?.details?.transaction, data?.result?.transaction];
  for (const x of candidates) if (isHash(x)) return x;
  return text.match(/"(?:transaction|transactionHash|txHash)"\s*:\s*"(0x[0-9a-fA-F]{64})"/i)?.[1] || "";
}

async function recoverLateBase(env, identity, responseData, responseText) {
  if (identity.network !== BASE_CAIP || String(identity.asset).toLowerCase() !== BASE_USDC.toLowerCase() || !isAddress(identity.from) || !isNonce(identity.nonce)) return null;
  const client = createPublicClient({ chain: base, transport: http(env.BASE_RPC_URL || "https://mainnet.base.org", { timeout: 5000, retryCount: 1 }) });
  const tx = txHashFrom(responseData, responseText);
  const deadline = Date.now() + Math.max(8000, Math.min(30000, Number(env.RECOVERY_WINDOW_MS || 24000)));
  let delay = 1200;
  while (Date.now() < deadline) {
    if (tx) {
      try {
        const receipt = await client.getTransactionReceipt({ hash: tx });
        if (receipt?.status === "success") return { transaction: tx, resolution: "confirmed_late" };
        if (receipt?.status === "reverted") return null;
      } catch {}
    }
    try {
      const used = await client.readContract({ address: BASE_USDC, abi: AUTH_STATE, functionName: "authorizationState", args: [identity.from, identity.nonce] });
      if (used) {
        const latest = await client.getBlockNumber();
        const fromBlock = latest > 3000n ? latest - 3000n : 0n;
        const logs = await client.getLogs({ address: BASE_USDC, event: AUTH_USED, args: { authorizer: identity.from, nonce: identity.nonce }, fromBlock, toBlock: latest });
        if (logs.length) return { transaction: logs[logs.length - 1].transactionHash, resolution: "confirmed_late" };
        return { transaction: "", resolution: "nonce_used_ambiguous" };
      }
    } catch {}
    await sleep(delay);
    delay = Math.min(3200, Math.round(delay * 1.45));
  }
  return null;
}

async function consumeRecoveredCredit(env, key) {
  if (!key) return;
  try {
    await fetch(`${String(env.XGUARD_BILLING_URL || "https://hooks.xguardgate.com").replace(/\/$/, "")}/v1/consume`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, body: JSON.stringify({ units: Number(env.SETTLEMENT_CREDITS || 2) })
    });
  } catch {}
}
async function confirmRecoveredFree(env, payTo, nonce) {
  if (!payTo || !nonce) return;
  try {
    const stub = env.QUOTAS.get(env.QUOTAS.idFromName(String(payTo).toLowerCase()));
    await stub.fetch("https://quota/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nonce, limit: Number(env.FREE_SETTLEMENTS || 25) }) });
  } catch {}
}

function successResponse(record, replayed = false) {
  return json({ success: true, payer: record.payer, transaction: record.transaction, network: record.network, receiptId: record.receipt_id, idempotent: replayed }, 200, {
    "x-xguard-receipt-id": record.receipt_id,
    "x-xguard-recovered": record.recovered ? "1" : "0",
    "x-xguard-resolution": record.resolution || "confirmed",
    ...(replayed ? { "x-xguard-idempotent-replay": "1" } : {})
  });
}

async function handleSettle(request, env) {
  let body = null;
  try { body = JSON.parse(await request.clone().text()); } catch { return relay.fetch(request, env); }
  const identity = paymentIdentity(body);
  const id = await receiptId(identity);
  if (id) {
    const prior = await getReceipt(env, id);
    if (prior?.status === "confirmed" && String(prior.pay_to || "").toLowerCase() === String(identity.payTo || "").toLowerCase()) return successResponse(prior, true);
  }

  const response = await relay.fetch(request, env);
  const text = await response.clone().text();
  let data = null; try { data = JSON.parse(text); } catch {}
  const success = response.ok && (data?.success === true || data?.settled === true);
  if (success && id) {
    const record = {
      receipt_id: id, status: "confirmed", transaction: txHashFrom(data, text), network: identity.network,
      payer: identity.from, pay_to: identity.payTo, asset: identity.asset, amount: identity.amount,
      recovered: response.headers.get("x-xguard-recovered") === "1", resolution: response.headers.get("x-xguard-recovered") === "1" ? "authorization_recovered" : "upstream",
      upstream: response.headers.get("x-xguard-upstream") || "", created_at: new Date().toISOString()
    };
    await putReceipt(env, id, record);
    const headers = new Headers(response.headers); headers.set("x-xguard-receipt-id", id); headers.set("x-xguard-resolution", record.resolution);
    return new Response(response.body, { status: response.status, headers });
  }

  if (response.status >= 500 && id) {
    const late = await recoverLateBase(env, identity, data, text);
    if (late?.transaction) {
      const key = bearer(request);
      if (key) await consumeRecoveredCredit(env, key); else await confirmRecoveredFree(env, identity.payTo, identity.nonce);
      const record = {
        receipt_id: id, status: "confirmed", transaction: late.transaction, network: identity.network,
        payer: identity.from, pay_to: identity.payTo, asset: identity.asset, amount: identity.amount,
        recovered: true, resolution: late.resolution, upstream: response.headers.get("x-xguard-upstream") || "direct-base-poll",
        created_at: new Date().toISOString()
      };
      await putReceipt(env, id, record);
      return successResponse(record);
    }
  }
  return response;
}

async function oldHealth(env) {
  const r = await relay.fetch(new Request("https://api.xguardgate.com/healthz"), env);
  const h = await r.json().catch(() => ({}));
  return { ...h, service: "XGuard Reliability Gateway", version: VERSION, recovery_window_ms: Number(env.RECOVERY_WINDOW_MS || 24000), durable_receipts: true, standalone_reconcile: RECONCILE };
}

function esc(s) { return String(s).replace(/[&<>\"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
async function landing(env) {
  const h = await oldHealth(env); const ups = Array.isArray(h.upstreams) ? h.upstreams : []; const live = ups.filter(x => x.ok).length;
  const rows = ups.map(x => `<div class="u"><i class="${x.ok ? "on" : "off"}"></i><span>${esc(x.host)}</span><b>${x.ok ? `${x.latency_ms}ms` : "offline"}</b></div>`).join("");
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard — x402 Reliability Gateway</title><meta name="description" content="Drop-in x402 reliability gateway with facilitator failover, late-confirmation recovery and durable settlement receipts."><style>
:root{--bg:#070809;--p:#0d1113;--l:#20282d;--t:#f4f7f5;--m:#98a49e;--x:#b8ff42;--c:#70e8ff}*{box-sizing:border-box}body{margin:0;background:radial-gradient(900px 600px at 80% -8%,rgba(112,232,255,.10),transparent 58%),radial-gradient(800px 500px at 5% 8%,rgba(184,255,66,.08),transparent 58%),var(--bg);color:var(--t);font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;letter-spacing:-.01em}.w{width:min(1160px,calc(100% - 36px));margin:auto}.nav{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid #171c1f}.logo{font-weight:950;letter-spacing:.08em}.logo:before{content:"X";display:inline-grid;place-items:center;width:29px;height:29px;margin-right:10px;border:1px solid var(--x);border-radius:8px;color:var(--x);font-size:12px}.nav a{color:#c1cac5;text-decoration:none;margin-left:22px}.hero{display:grid;grid-template-columns:1.08fr .92fr;gap:56px;align-items:center;padding:92px 0 70px}.tag{display:inline-flex;gap:8px;align-items:center;border:1px solid #2a3237;border-radius:999px;padding:6px 10px;color:#c5cec9;font:12px ui-monospace,monospace}.tag:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--x);box-shadow:0 0 14px var(--x)}h1{font-size:clamp(52px,7.7vw,92px);line-height:.92;letter-spacing:-.065em;margin:22px 0 24px}.lime{color:var(--x)}.lead{font-size:20px;color:#a8b3ad;max-width:690px}.btns{display:flex;gap:10px;flex-wrap:wrap;margin-top:30px}.btn{display:inline-flex;align-items:center;min-height:48px;padding:0 17px;border-radius:11px;text-decoration:none;font-weight:850}.pri{background:var(--x);color:#071004}.sec{border:1px solid #30393e;color:#f5f7f6}.note{margin-top:22px;color:#7f8b85;font-size:13px}.note b{color:#d4ddd8}.term{border:1px solid #273138;background:linear-gradient(#101518,#080b0d);border-radius:22px;overflow:hidden;box-shadow:0 28px 90px rgba(0,0,0,.35)}.th{height:46px;padding:0 16px;border-bottom:1px solid #222a2f;display:flex;align-items:center;justify-content:space-between;color:#7f8c86;font:11px ui-monospace,monospace}.tb{padding:18px}.live{display:flex;justify-content:space-between;margin-bottom:8px}.live b{color:var(--x);font:11px ui-monospace,monospace}.u{display:grid;grid-template-columns:13px 1fr auto;gap:8px;align-items:center;padding:10px 2px;border-top:1px solid #1c2327}.u:first-of-type{border-top:0}.u i{width:7px;height:7px;border-radius:50%}.on{background:var(--x);box-shadow:0 0 10px var(--x)}.off{background:#ff6c6c}.u b{color:#78857f;font:11px ui-monospace,monospace}.trace{margin-top:14px;background:#080a0c;border:1px solid #1f272c;border-radius:12px;padding:13px;color:#8fa09a;font:12px/1.75 ui-monospace,monospace}.trace strong{color:var(--x)}.stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;padding-bottom:76px}.s{border:1px solid var(--l);border-radius:16px;padding:21px;background:rgba(13,17,19,.72)}.s b{display:block;font-size:27px}.s span{color:var(--m);font-size:13px}.section{padding:82px 0;border-top:1px solid #171c1f}.k{color:var(--x);font:11px ui-monospace,monospace;letter-spacing:.12em;text-transform:uppercase}h2{font-size:clamp(38px,5vw,58px);line-height:1.02;letter-spacing:-.05em;margin:12px 0 18px}.sub{font-size:18px;color:#9ba7a1;max-width:760px}.g3,.g2{display:grid;gap:14px;margin-top:34px}.g3{grid-template-columns:repeat(3,1fr)}.g2{grid-template-columns:1fr 1fr}.card{border:1px solid var(--l);border-radius:18px;padding:24px;background:linear-gradient(#0f1316,#0a0d0f)}.card small{color:#69766f;font:11px ui-monospace,monospace}.card h3{font-size:23px;margin:38px 0 10px}.card p{color:#929f99;margin:0}.prod{min-height:260px}.prod.hot{border-color:#435333;background:linear-gradient(145deg,rgba(184,255,66,.09),#0a0d0f 58%)}.pill{display:inline-block;border:1px solid #33403a;border-radius:999px;padding:5px 8px;color:#aab6b0;font:10px ui-monospace,monospace}.prod h3{font-size:31px;margin:28px 0 8px}.prod a{color:var(--x);text-decoration:none;font-weight:850}.code{margin-top:34px;border:1px solid #263037;border-radius:17px;background:#080a0c;overflow:hidden}.code div{padding:11px 16px;border-bottom:1px solid #20272c;color:#77847e;font:11px ui-monospace,monospace}.code pre{margin:0;padding:20px;overflow:auto;color:#dce4df;font:13px/1.8 ui-monospace,monospace}.price{font-size:43px;font-weight:900;letter-spacing:-.055em}.final{text-align:center;padding:92px 0 105px}.final h2{max-width:850px;margin:12px auto 22px}.foot{border-top:1px solid #171c1f;padding:25px 0 34px;display:flex;justify-content:space-between;color:#6f7c76;font-size:12px}@media(max-width:880px){.hero{grid-template-columns:1fr}.stats,.g3{grid-template-columns:1fr 1fr}.g2{grid-template-columns:1fr}.nav .hide{display:none}}@media(max-width:600px){.w{width:calc(100% - 24px)}h1{font-size:54px}.stats,.g3{grid-template-columns:1fr}.hero{padding-top:62px}.final{text-align:left}}
</style></head><body><main class="w"><nav class="nav"><div class="logo">XGUARD</div><div><a class="hide" href="#why">Why</a><a class="hide" href="#products">Products</a><a href="/docs">Docs ↗</a></div></nav><section class="hero"><div><span class="tag">x402 payment reliability layer</span><h1>Don't lose paid requests to <span class="lime">facilitator failures.</span></h1><p class="lead">XGuard sits in the x402 payment path. It routes around unhealthy facilitators, watches Base for late confirmations after timeouts, and creates durable settlement receipts so retries stay idempotent.</p><div class="btns"><a class="btn pri" href="${CHECKOUT}">Start with 25 free settlements</a><a class="btn sec" href="#integrate">See integration</a></div><p class="note"><b>No custody.</b> No private keys. Buyer funds still settle directly to the merchant.</p></div><div class="term"><div class="th"><span>xguard / live routing</span><span>production</span></div><div class="tb"><div class="live"><strong>Facilitators</strong><b>${live}/${ups.length} LIVE</b></div>${rows}<div class="trace">POST /settle<br>→ facilitator timeout<br>→ direct Base polling<br><strong>→ confirmed_late · receipt persisted</strong></div></div></div></section><section class="stats"><div class="s"><b>${live}/${ups.length}</b><span>upstreams live now</span></div><div class="s"><b>${Number(env.RECOVERY_WINDOW_MS || 24000) / 1000}s</b><span>late-confirmation window</span></div><div class="s"><b>$0</b><span>verification calls</span></div><div class="s"><b>${Number(env.FREE_SETTLEMENTS || 25)}</b><span>free successful settlements</span></div></section><section class="section" id="why"><span class="k">The failure XGuard closes</span><h2>One timeout should not turn a successful payment into a failed request.</h2><p class="sub">x402's verify → settle flow creates an operational gap: a facilitator can stop waiting while Base confirms the transfer seconds later. XGuard keeps watching before it declares failure.</p><div class="g3"><div class="card"><small>01 / ROUTE</small><h3>Automatic failover</h3><p>One facilitator URL fronts multiple production settlement paths and avoids repeatedly failing routes.</p></div><div class="card"><small>02 / RECOVER</small><h3>Late confirmation recovery</h3><p>After a Base settlement error, XGuard polls transaction state and EIP-3009 authorization usage before giving up.</p></div><div class="card"><small>03 / PROVE</small><h3>Durable receipts</h3><p>Every confirmed settlement gets an XGuard receipt ID. Replaying the same authorization returns the stored result instead of broadcasting again.</p></div></div></section><section class="section" id="products"><span class="k">Two products, one failure domain</span><h2>Protect the flow before or after a timeout.</h2><div class="g2"><div class="card prod hot"><span class="pill">PRIMARY</span><h3>XGuard Relay</h3><p>Drop-in /verify and /settle gateway with routing, recovery and idempotent receipts.</p><a href="#integrate">Use api.xguardgate.com →</a></div><div class="card prod"><span class="pill">$0.002 x402 CALL</span><h3>XGuard Reconcile</h3><p>Standalone x402 endpoint for checking whether an EIP-3009 authorization actually settled after a timeout.</p><a href="${RECONCILE}/llms.txt">Machine-readable docs →</a></div></div></section><section class="section" id="integrate"><span class="k">Integration</span><h2>Change one facilitator URL.</h2><p class="sub">Your client payment payload stays untouched. Your merchant address stays untouched. Only facilitator traffic moves through XGuard.</p><div class="code"><div>server configuration</div><pre>FACILITATOR_URL=https://api.xguardgate.com

POST /verify    # free
POST /settle    # routing + recovery + receipt
GET  /supported
GET  /v1/receipts/{receipt_id}

Authorization: Bearer YOUR_XGUARD_LICENSE_KEY</pre></div></section><section class="section"><span class="k">Pricing</span><h2>Charge only when XGuard gets a settlement through.</h2><div class="g2"><div class="card"><span class="pill">EVALUATION</span><div class="price">$0</div><p>Verification stays free. The first 25 successful settlements per merchant are included.</p></div><div class="card hot"><span class="pill">USAGE</span><div class="price">2 credits</div><p>Per successful routed settlement. Failed settlements consume nothing. No subscription.</p></div></div></section><section class="final"><span class="k">Production</span><h2>Put reliability in the payment path before the next timeout costs the request.</h2><div class="btns" style="justify-content:center"><a class="btn pri" href="${CHECKOUT}">Get usage credits</a><a class="btn sec" href="/healthz">Live health</a></div></section><footer class="foot"><span>XGuard Reliability Gateway · ${VERSION}</span><span>Base · x402 v2 · Cloudflare Workers</span></footer></main></body></html>`;
  return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=30", "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action https://lfsystems.lemonsqueezy.com", "x-frame-options": "DENY", "x-content-type-options": "nosniff" } });
}

function docs(env) {
  return json({ name: "XGuard Reliability Gateway", version: VERSION, facilitator_url: "https://api.xguardgate.com", endpoints: { supported: "GET /supported", verify: "POST /verify", settle: "POST /settle", health: "GET /healthz", receipt: "GET /v1/receipts/{receipt_id}", balance: "GET /v1/balance", reconcile: `${RECONCILE}/v1/reconcile?from=0x...&nonce=0x...` }, pricing: { verify_credits: 0, free_successful_settlements: Number(env.FREE_SETTLEMENTS || 25), credits_per_successful_settlement: Number(env.SETTLEMENT_CREDITS || 2), failed_settlements_charged: false, checkout: env.XGUARD_CHECKOUT_URL || CHECKOUT }, behavior: { multi_facilitator_routing: true, base_late_confirmation_polling: true, durable_idempotency_receipts: true, non_custodial: true } });
}

export class MerchantQuota {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const path = new URL(request.url).pathname; const body = await request.json().catch(() => ({})); const nonce = String(body.nonce || ""); const limit = Math.max(0, Number(body.limit || 25));
    const state = (await this.ctx.storage.get("state")) || { success: 0, pending: {}, confirmed: {} }; state.pending ||= {}; state.confirmed ||= {};
    const cutoff = Date.now() - 120000; for (const [k, ts] of Object.entries(state.pending)) if (Number(ts) < cutoff) delete state.pending[k];
    const confirm = async force => { if (nonce && state.confirmed[nonce]) return json({ ok: true, success: state.success, idempotent: true }); if (nonce && (force || state.pending[nonce])) { delete state.pending[nonce]; state.confirmed[nonce] = Date.now(); state.success += 1; const keys = Object.keys(state.confirmed); if (keys.length > 2000) for (const k of keys.sort((a,b)=>state.confirmed[a]-state.confirmed[b]).slice(0, keys.length - 1500)) delete state.confirmed[k]; await this.ctx.storage.put("state", state); } return json({ ok: true, success: state.success }); };
    if (path === "/admit") { if (state.success + Object.keys(state.pending).length >= limit) return json({ error: "free_quota_exhausted", success: state.success }, 402); const id = nonce || crypto.randomUUID(); state.pending[id] = Date.now(); await this.ctx.storage.put("state", state); return json({ ok: true, nonce: id, success: state.success }); }
    if (path === "/commit") return confirm(false);
    if (path === "/confirm") return confirm(true);
    if (path === "/release") { if (nonce && state.pending[nonce]) { delete state.pending[nonce]; await this.ctx.storage.put("state", state); } return json({ ok: true, success: state.success }); }
    return json({ error: "not_found" }, 404);
  }
}

export class SettlementReceipt {
  constructor(ctx) { this.ctx = ctx; }
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if (path === "/get" && request.method === "GET") { const record = await this.ctx.storage.get("record"); return record ? json(record) : json({ error: "receipt_not_found" }, 404); }
    if (path === "/record" && request.method === "POST") { const incoming = await request.json().catch(() => null); if (!incoming?.receipt_id || incoming.status !== "confirmed") return json({ error: "invalid_receipt" }, 400); const existing = await this.ctx.storage.get("record"); if (existing?.status === "confirmed") return json(existing); await this.ctx.storage.put("record", incoming); return json(incoming, 201); }
    return json({ error: "not_found" }, 404);
  }
}

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return landing(env);
      if (url.pathname === "/healthz" && request.method === "GET") return json(await oldHealth(env));
      if (url.pathname === "/docs" && request.method === "GET") return docs(env);
      if (url.pathname === "/settle" && request.method === "POST") return handleSettle(request, env);
      const m = url.pathname.match(/^\/v1\/receipts\/(xgr_[a-f0-9]{40})$/); if (m && request.method === "GET") { const record = await getReceipt(env, m[1]); return record ? json(record) : json({ error: "receipt_not_found" }, 404); }
      if (url.pathname === "/llms.txt" && request.method === "GET") return new Response(`XGuard Reliability Gateway\nFacilitator URL: https://api.xguardgate.com\nPOST /verify — free routing\nPOST /settle — routing + late Base recovery + durable receipt\nGET /v1/receipts/{receipt_id}\nStandalone reconciliation: ${RECONCILE}/llms.txt\nDocs: https://api.xguardgate.com/docs\n`, { headers: { "content-type": "text/plain; charset=utf-8" } });
      if (url.pathname === "/.well-known/x402" && request.method === "GET") return docs(env);
      return relay.fetch(request, env);
    } catch (error) { console.error(JSON.stringify({ event: "gateway_error", error: String(error?.message || error) })); return json({ error: error?.message || "internal_error" }, Number(error?.status || 500)); }
  }
};
