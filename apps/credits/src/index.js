const CHECKOUT = "https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab";
const API = "https://hooks.xguardgate.com";

const json = (x, status = 200) => new Response(JSON.stringify(x), {
  status,
  headers: {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff"
  }
});

function page() {
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard Transaction Assurance</title>
<meta name="description" content="Buy XGuard usage credits and run replay-resistant transaction assurance checks for AI agents and automated systems.">
<style>
:root{color-scheme:dark;--bg:#07090d;--panel:#10151e;--ink:#f5f7fb;--muted:#9aa4b5;--line:#283140;--good:#5ee0bf}*{box-sizing:border-box}body{margin:0;background:radial-gradient(circle at 85% 0,#17203a 0,transparent 32%),var(--bg);color:var(--ink);font:16px/1.55 Inter,system-ui,sans-serif}.wrap{max-width:1020px;margin:auto;padding:28px}.nav{display:flex;align-items:center;justify-content:space-between;padding:10px 0 44px}.brand{font-weight:800;letter-spacing:-.02em}.brand span{color:#9da6b6;font-weight:600}.pill{font:12px ui-monospace,monospace;border:1px solid var(--line);border-radius:999px;padding:7px 10px;color:#b8c0cd}.hero{padding:38px 0 28px}.eyebrow{color:var(--good);font:12px ui-monospace,monospace;text-transform:uppercase;letter-spacing:.1em}.hero h1{font-size:clamp(48px,8vw,82px);line-height:.95;letter-spacing:-.06em;margin:18px 0 22px;max-width:900px}.hero p{font-size:20px;color:var(--muted);max-width:780px}.actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:28px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;border-radius:11px;text-decoration:none;font-weight:750;border:1px solid var(--line);background:#151b26;color:#fff}.btn.primary{background:#f6f7fb;color:#080b10;border-color:#f6f7fb}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:54px}.card{background:rgba(16,21,30,.9);border:1px solid var(--line);border-radius:18px;padding:24px}.card h2{font-size:20px;margin:0 0 10px}.card p{color:var(--muted);margin:0 0 18px}.steps{counter-reset:s}.step{display:grid;grid-template-columns:34px 1fr;gap:12px;padding:13px 0;border-top:1px solid var(--line)}.step:first-of-type{border-top:0}.n{width:28px;height:28px;border:1px solid var(--line);border-radius:8px;display:grid;place-items:center;color:#a8b1c0;font:11px ui-monospace,monospace}code,pre,input,button{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}pre{white-space:pre-wrap;background:#06080c;border:1px solid var(--line);border-radius:12px;padding:15px;color:#d7deea;overflow:auto;font-size:13px}.checker{margin-top:54px}.checker form{display:flex;gap:10px}.checker input{flex:1;background:#090d13;color:#fff;border:1px solid var(--line);border-radius:10px;padding:13px}.checker button{border:0;border-radius:10px;padding:0 16px;font-weight:800;cursor:pointer}.result{margin-top:12px;min-height:24px;color:#cdd5e1}.small{font-size:12px;color:#758093;margin-top:10px}footer{border-top:1px solid var(--line);margin-top:64px;padding:24px 0;color:#788395;font-size:13px}@media(max-width:760px){.grid{grid-template-columns:1fr}.checker form{display:grid}.hero p{font-size:18px}}
</style>
</head>
<body>
<div class="wrap">
  <div class="nav"><div class="brand">XGuard <span>Transaction Assurance</span></div><div class="pill">5,000 checks / purchase</div></div>
  <section class="hero"><div class="eyebrow">Live · pay once</div><h1>One API check before an automated transaction leaves your agent.</h1><p>XGuard validates HTTPS/public-network targeting, request freshness, amount shape and idempotency, then records the idempotency key to reject replays. One successful assurance consumes one credit.</p><div class="actions"><a class="btn primary" href="${CHECKOUT}">Buy 5,000 checks</a><a class="btn" href="#use">API example</a></div></section>
  <div class="grid">
    <section class="card"><h2>After payment</h2><div class="steps"><div class="step"><div class="n">1</div><div>Checkout is handled by Lemon Squeezy.</div></div><div class="step"><div class="n">2</div><div>Your receipt contains a unique license key.</div></div><div class="step"><div class="n">3</div><div>XGuard provisions 5,000 credits automatically.</div></div><div class="step"><div class="n">4</div><div>Use that key as the Bearer token on <code>/v1/assure</code>.</div></div></div></section>
    <section class="card" id="use"><h2>Billable assurance call</h2><p>Each successful new idempotency key consumes exactly one credit. Reusing the same key returns <code>replay_detected</code> without a second debit.</p><pre>curl -X POST ${API}/v1/assure \\
  -H "Authorization: Bearer YOUR_LICENSE_KEY" \\
  -H "Content-Type: application/json" \\
  -d '{
    "action":"purchase",
    "target":"https://merchant.example/pay",
    "method":"POST",
    "amount":{"value":49.99,"currency":"USD"},
    "idempotency_key":"order-2026-000123",
    "expires_at":"2026-08-25T13:30:00Z"
  }'</pre><pre>{
  "decision":"allow",
  "assurance_id":"xga_...",
  "credits_remaining":4999,
  "consumed":1
}</pre></section>
  </div>
  <section class="card checker"><h2>Check your balance</h2><p>Paste your license key. This page forwards it only to the XGuard credit ledger for the balance lookup and does not store it.</p><form id="f"><input id="k" type="password" autocomplete="off" placeholder="XXXX-XXXX-XXXX-XXXX..." required><button type="submit">Check balance</button></form><div id="r" class="result"></div><div class="small">Full refunds revoke remaining credits automatically when the refund webhook is received; partial refunds reduce the remaining allowance proportionally.</div></section>
  <footer>XGuard Transaction Assurance · Lemon Squeezy checkout · Cloudflare Workers credit ledger.</footer>
</div>
<script>
const f=document.getElementById('f'),k=document.getElementById('k'),r=document.getElementById('r');
f.addEventListener('submit',async e=>{e.preventDefault();r.textContent='Checking…';try{const x=await fetch('/api/balance',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({key:k.value.trim()})});const d=await x.json();r.textContent=x.ok?('Balance: '+d.credits+' credits'+(d.revoked?' · revoked':'')):(d.error==='unknown_key'?'Key not found.':'Could not check this key.')}catch{r.textContent='Could not reach XGuard.'}});
</script>
</body>
</html>`;

  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=120",
      "content-security-policy": "default-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; connect-src 'self'; form-action https://lfsystems.lemonsqueezy.com; frame-ancestors 'none'; base-uri 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/healthz") return json({status:"ok",service:"XGuard Transaction Assurance",credits_per_purchase:5000,billable_endpoint:"/v1/assure"});
    if (url.pathname === "/api/balance") {
      if (request.method !== "POST") return json({error:"method_not_allowed"},405);
      let body;
      try { body = await request.json(); } catch { return json({error:"invalid_json"},400); }
      const key = String(body?.key || "").trim();
      if (!key || key.length > 256) return json({error:"invalid_key"},400);
      const upstream = await fetch(`${API}/v1/balance`, { headers: { authorization: `Bearer ${key}` } });
      const text = await upstream.text();
      return new Response(text, { status: upstream.status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" } });
    }
    if (url.pathname === "/" && (request.method === "GET" || request.method === "HEAD")) return page();
    return json({error:"not_found"},404);
  }
};
