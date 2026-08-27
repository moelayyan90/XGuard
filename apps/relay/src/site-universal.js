import gateway from "./gateway.js";

const API = "https://api.xguardgate.com";
const VERSION = "5.0.1";
const CHECKOUT = "https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab";

function esc(value) {
  return String(value ?? "").replace(/[&<>\"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
}

async function home(request, env) {
  let health = {};
  try {
    const response = await gateway.fetch(new Request(`${API}/healthz`), env);
    health = await response.json();
  } catch {}

  const upstreams = Array.isArray(health.upstreams) ? health.upstreams : [];
  const live = upstreams.filter(row => row.ok);
  const free = Math.max(0, Number(env.FREE_SETTLEMENTS || 25));
  const credits = Math.max(1, Number(env.SETTLEMENT_CREDITS || 2));
  const checkout = env.XGUARD_CHECKOUT_URL || CHECKOUT;
  const liveRows = upstreams.map(row => `<li><span class="dot ${row.ok ? "on" : "off"}"></span><b>${esc(row.host)}</b><small>${row.ok ? `${Number(row.latency_ms || 0)} ms` : "offline"}</small></li>`).join("");
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "XGuard High-Velocity x402 Facilitator",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    softwareVersion: VERSION,
    url: "https://xguardgate.com/",
    sameAs: ["https://github.com/moelayyan90/XGuard"],
    description: "Non-custodial x402 v2 facilitator gateway with capability/health routing, Bazaar discovery, replay protection and reconciliation-gated settlement failover."
  }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard — High-Velocity x402 Facilitator</title>
<meta name="description" content="Non-custodial x402 v2 facilitator gateway with automatic compatible routing, Bazaar discovery, replay protection and reconciliation-gated settlement failover.">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="https://xguardgate.com/">
<link rel="alternate" type="application/json" href="${API}/facilitator" title="XGuard facilitator metadata">
<link rel="alternate" type="text/plain" href="${API}/llms.txt" title="XGuard LLM discovery">
<meta property="og:type" content="website">
<meta property="og:title" content="XGuard — High-Velocity x402 Facilitator">
<meta property="og:description" content="One non-custodial x402 facilitator URL with machine discovery and reconciliation-gated settlement failover.">
<meta property="og:url" content="https://xguardgate.com/">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${structuredData}</script>
<style>
:root{--bg:#07090d;--panel:#0d1118;--line:#202938;--text:#f5f7fb;--muted:#97a4b7;--blue:#4f8cff;--green:#4ee39b;--red:#ff6978}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(900px 520px at 50% -5%,#173b7955,transparent 64%),var(--bg);color:var(--text);font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif}.wrap{width:min(1120px,calc(100% - 34px));margin:auto}.nav{height:72px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{font-weight:900;letter-spacing:-.03em;font-size:20px}.brand i{display:inline-grid;place-items:center;width:31px;height:31px;margin-right:9px;border:1px solid #427de0;border-radius:9px;color:#78a6ff;font-style:normal;font-size:12px}.nav a{color:#aab5c5;text-decoration:none;font-size:13px;margin-left:22px}.nav .cta{padding:10px 15px;border-radius:10px;background:white;color:#0a0d12;font-weight:800}.hero{padding:98px 0 72px;text-align:center}.badge{display:inline-flex;align-items:center;gap:8px;border:1px solid #294a78;border-radius:999px;padding:7px 11px;color:#9fc0ff;font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.08em}.badge:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--green);box-shadow:0 0 15px var(--green)}h1{font-size:clamp(52px,8vw,92px);line-height:.95;letter-spacing:-.07em;max-width:1000px;margin:22px auto}.blue{color:#6fa2ff}.lead{max-width:820px;margin:0 auto;color:var(--muted);font-size:18px;line-height:1.72}.actions{display:flex;justify-content:center;gap:10px;flex-wrap:wrap;margin-top:30px}.btn{padding:13px 17px;border-radius:11px;text-decoration:none;font-weight:850;font-size:13px}.primary{background:var(--blue);color:white}.secondary{border:1px solid #303b4e;color:white}.endpoint{margin:32px auto 0;max-width:720px;border:1px solid #2b3442;background:#0a0e14;border-radius:14px;padding:16px 18px;font-family:ui-monospace,SFMono-Regular,Consolas,monospace;font-size:15px;color:#cfe0ff;text-align:left;display:flex;justify-content:space-between;gap:18px}.endpoint span{color:#617087}.strip{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:74px}.stat{background:linear-gradient(180deg,#101620,#0b0f15);border:1px solid var(--line);border-radius:16px;padding:20px}.stat b{display:block;font-size:28px;letter-spacing:-.04em}.stat span{color:var(--muted);font-size:11px}.section{border-top:1px solid var(--line);padding:82px 0}.kicker{color:#76a7ff;font-size:11px;font-weight:900;letter-spacing:.11em;text-transform:uppercase}.section h2{font-size:clamp(38px,5vw,58px);line-height:1.03;letter-spacing:-.055em;margin:12px 0 18px;max-width:820px}.section p{color:var(--muted);line-height:1.75;max-width:760px}.flow{display:grid;grid-template-columns:1fr 60px 1.2fr 60px 1fr;align-items:center;margin-top:38px}.box{border:1px solid var(--line);border-radius:18px;padding:22px;background:var(--panel);min-height:145px}.box small{display:block;color:#738095;font-size:10px;text-transform:uppercase;letter-spacing:.08em;margin-bottom:12px}.box b{font-size:20px}.box p{font-size:12px;margin:8px 0 0}.arrow{text-align:center;color:#5b8fe9;font-size:24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:32px}.card{border:1px solid var(--line);border-radius:17px;background:#0b0f15;padding:22px}.card h3{font-size:18px;margin:0 0 10px}.card p{font-size:13px;margin:0}.code{margin-top:30px;border:1px solid var(--line);background:#080b10;border-radius:16px;padding:18px;overflow:auto;color:#bed2f7;font:12px/1.9 ui-monospace,SFMono-Regular,Consolas,monospace}.livegrid{display:grid;grid-template-columns:1fr 1fr;gap:30px;align-items:start}.routes{list-style:none;margin:28px 0 0;padding:0;border:1px solid var(--line);border-radius:15px;overflow:hidden}.routes li{display:grid;grid-template-columns:16px 1fr auto;gap:8px;align-items:center;padding:13px 15px;border-top:1px solid var(--line);background:#0b0f15}.routes li:first-child{border-top:0}.routes small{color:#718096}.dot{width:7px;height:7px;border-radius:50%}.on{background:var(--green);box-shadow:0 0 12px #4ee39b88}.off{background:var(--red)}.truth{font-size:12px;color:#788699;margin-top:14px}.pricing{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:30px}.price{border:1px solid var(--line);border-radius:17px;padding:22px;background:#0b0f15}.price strong{display:block;font-size:30px;margin:8px 0}.price small,.price p{color:var(--muted);font-size:12px;line-height:1.65}.final{margin:72px 0 38px;border:1px solid #315a9a;background:linear-gradient(120deg,#10244a,#123d82);border-radius:22px;padding:34px;display:flex;align-items:center;justify-content:space-between;gap:24px}.final h3{font-size:28px;margin:0}.final p{margin:7px 0 0;color:#b9ccef}.final a{background:white;color:#0c1627;text-decoration:none;border-radius:11px;padding:13px 17px;font-size:13px;font-weight:900;white-space:nowrap}.foot{display:flex;justify-content:space-between;color:#657286;font-size:11px;padding:0 0 34px}@media(max-width:820px){.nav a:not(.cta){display:none}.strip,.grid,.pricing{grid-template-columns:1fr 1fr}.flow{grid-template-columns:1fr}.arrow{transform:rotate(90deg);padding:10px}.livegrid{grid-template-columns:1fr}.final{display:block}.final a{display:inline-block;margin-top:18px}}@media(max-width:560px){.strip,.grid,.pricing{grid-template-columns:1fr}.hero{padding-top:65px}.endpoint{font-size:11px}.foot{display:block}.foot span{display:block;margin-top:6px}}
</style>
</head>
<body>
<div class="wrap">
<nav class="nav"><div class="brand"><i>X</i>XGuard</div><div><a href="#money-path">Money path</a><a href="#discovery">Discovery</a><a href="#routing">Routing</a><a class="cta" href="${API}/facilitator">Machine-readable</a></div></nav>
<section class="hero"><div class="badge">v${VERSION} · live x402 money-path facilitator</div><h1>One URL in the <span class="blue">x402 money path.</span></h1><p class="lead">Resource servers configure XGuard once. Verification can route around unavailable providers. Settlement is stricter: explicit rate-limit rejection may fail over, while ambiguous timeout/5xx outcomes fail closed unless reconciliation proves retry safety. Base USDC uses on-chain authorization-state reconciliation.</p><div class="actions"><a class="btn primary" href="${API}/facilitator">Discover XGuard →</a><a class="btn secondary" href="${API}/supported">Live /supported</a><a class="btn secondary" href="${API}/llms.txt">Agent discovery</a><a class="btn secondary" href="https://github.com/moelayyan90/XGuard">GitHub</a></div><div class="endpoint"><b>${API}</b><span>facilitator URL</span></div></section>
<div class="strip"><div class="stat"><b>${live.length}/${Math.max(upstreams.length,live.length)}</b><span>configured settlement providers healthy now</span></div><div class="stat"><b>1</b><span>facilitator URL for the resource server</span></div><div class="stat"><b>3</b><span>core money-path calls: supported / verify / settle</span></div><div class="stat"><b>0</b><span>recipient or signed amount mutations</span></div></div>
<section class="section" id="money-path"><span class="kicker">The actual chokepoint</span><h2>XGuard is not beside the transaction. It is the configured facilitator.</h2><p>When a resource server points its x402 facilitator to XGuard, verification and settlement enter XGuard before a downstream facilitator is selected. XGuard never changes the signed recipient or amount.</p><div class="flow"><div class="box"><small>01 · PAID RESOURCE</small><b>Agent + Resource Server</b><p>The agent receives the normal x402 payment requirements.</p></div><div class="arrow">→</div><div class="box"><small>02 · IN PATH</small><b>XGuard Facilitator</b><p>/verify · /settle · capability filter · health · latency · safe failover · replay guard</p></div><div class="arrow">→</div><div class="box"><small>03 · SETTLEMENT</small><b>Compatible live route</b><p>XGuard selects the downstream route per request, while ambiguous settlement retries are reconciliation-gated.</p></div></div></section>
<section class="section" id="discovery"><span class="kicker">Machine discovery first</span><h2>Agents and crawlers should not need to know the name “XGuard” first.</h2><div class="grid"><div class="card"><h3>Facilitator identity</h3><p><code>/facilitator</code> and <code>/.well-known/x402</code> expose version, endpoints, live schemes, routing policy, settlement-safety policy and billing boundary.</p></div><div class="card"><h3>Bazaar catalogs</h3><p><code>/discovery/resources</code> and <code>/discovery/search</code> aggregate reachable x402 resource catalogs for agent-side discovery.</p></div><div class="card"><h3>Canonical MCP</h3><p><code>https://api.xguardgate.com/mcp</code> is the canonical remote MCP endpoint; the website alias is continuously checked against it in production.</p></div><div class="card"><h3>Fail closed</h3><p>Ambiguous settlement timeout/5xx outcomes do not trigger blind cross-facilitator replay. A retry requires evidence that it is safe.</p></div><div class="card"><h3>Base reconciliation</h3><p>For Base USDC, XGuard can inspect authorization state before allowing a retry after an ambiguous settlement outcome.</p></div><div class="card"><h3>DNS compatibility</h3><p>The <code>_x402.xguardgate.com</code> TXT publication is prepared but not claimed live until Cloudflare grants the repository token DNS edit permission. HTTP well-known discovery remains authoritative.</p></div></div><div class="code">GET ${API}/facilitator<br>GET ${API}/.well-known/x402<br>GET ${API}/discovery/resources<br>GET ${API}/discovery/search?query=weather<br>GET ${API}/v1/facilitator/route?network=eip155:8453&amp;scheme=exact<br>POST ${API}/mcp</div></section>
<section class="section" id="routing"><div class="livegrid"><div><span class="kicker">Automatic routing</span><h2>Configure XGuard. Do not configure the downstream.</h2><p>The downstream choice is recalculated from current scheme/network compatibility, provider health and observed latency. Verification may fail over on transport/provider failure. Settlement uses a narrower policy: explicit 429 rejection may move to another route; ambiguous timeout/5xx outcomes fail closed unless reconciliation proves the signed payment was not consumed.</p><p class="truth">Batch settlement is not advertised by marketing text. It becomes a live XGuard capability only when a healthy configured provider actually reports <code>scheme=batch-settlement</code> in <code>/supported</code>.</p></div><div><span class="kicker">Current configured routes</span><ul class="routes">${liveRows || '<li><span class="dot off"></span><b>No health snapshot</b><small>check /healthz</small></li>'}</ul></div></div></section>
<section class="section"><span class="kicker">Billing at the successful operation</span><h2>Charge XGuard usage without silently changing the merchant payment.</h2><div class="pricing"><div class="price"><small>Verification</small><strong>Free</strong><p>Discovery and x402 verification are not consumed from the settlement balance.</p></div><div class="price"><small>Free successful settlement allowance</small><strong>${free}</strong><p>Per payTo under the current gateway configuration.</p></div><div class="price"><small>After allowance</small><strong>${credits} credit${credits===1?'':'s'}</strong><p>Per successful settlement. Failed settlements are free. The signed payTo and amount are never rewritten.</p></div></div><p class="truth">Usage-credit billing is separate from the x402 merchant transfer. XGuard does not silently divert a percentage of the signed payment.</p></section>
<div class="final"><div><h3>Put one facilitator URL in the payment path.</h3><p>Then let XGuard choose compatible routes while refusing unsafe ambiguous settlement retries.</p></div><a href="${API}/facilitator">Open facilitator metadata →</a></div>
<footer class="foot"><span>XGuard v${VERSION} · High-Velocity x402 Facilitator</span><span>Non-custodial · automatic routing · fail-closed settlement safety · machine-discoverable</span></footer>
</div>
</body>
</html>`;

  const headers = {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "strict-transport-security": "max-age=31536000; includeSubDomains",
    "x-xguard-version": VERSION,
  };
  if (request.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(html, { status: 200, headers });
}

export default {
  async fetch(request, env) {
    if (request.method !== "GET" && request.method !== "HEAD") return new Response("method_not_allowed", { status: 405 });
    return home(request, env);
  },
};
