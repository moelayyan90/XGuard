const API = "https://xguardgate.com/api";
const SITE = "https://xguardgate.com";
const CHECKOUT = "https://lfsystems.lemonsqueezy.com/checkout/buy/f4c81819-1b10-4f1d-995d-46206a889dab";

function page(request, env) {
  const checkout = String(env.XGUARD_CHECKOUT_URL || CHECKOUT);
  const structuredData = JSON.stringify({
    "@context": "https://schema.org",
    "@type": "SoftwareApplication",
    name: "XGuard Action Rail",
    applicationCategory: "DeveloperApplication",
    operatingSystem: "Web",
    url: SITE,
    sameAs: ["https://github.com/moelayyan90/XGuard"],
    description: "Protocol-neutral execution control plane for AI agents. Scoped mandates, cryptographically signed single-use action permits, request binding, replay rejection and durable receipts for irreversible side effects."
  }).replace(/</g, "\\u003c");

  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard — Action Control Plane for AI Agents</title>
<meta name="description" content="Put a signed, single-use execution permit between an AI agent and every irreversible action: payments, purchases, bookings, messages, deployments, deletes, API writes and tool calls.">
<meta name="robots" content="index,follow,max-image-preview:large">
<link rel="canonical" href="${SITE}/">
<link rel="icon" type="image/svg+xml" href="${SITE}/favicon.svg">
<link rel="alternate" type="application/json" href="${API}/.well-known/xguard-actions.json" title="XGuard Action Rail">
<link rel="alternate" type="application/json" href="${API}/.well-known/xguard.json" title="XGuard protocol manifest">
<link rel="alternate" type="text/plain" href="${API}/llms.txt" title="XGuard LLM discovery">
<meta property="og:type" content="website">
<meta property="og:title" content="XGuard — Action Control Plane for AI Agents">
<meta property="og:description" content="No irreversible AI action without a scoped mandate and a single-use, request-bound permit.">
<meta property="og:url" content="${SITE}/">
<meta property="og:image" content="${SITE}/logo.svg">
<meta name="twitter:card" content="summary">
<script type="application/ld+json">${structuredData}</script>
<style>
:root{--paper:#f3f1eb;--ink:#0b0b0b;--panel:#161616;--line:#d2cec4;--muted:#68655e;--signal:#ff5a1f;--white:#fff;--green:#37b26c}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--paper);color:var(--ink);font-family:Arial,Helvetica,sans-serif;font-weight:400}.wrap{width:min(1180px,calc(100% - 40px));margin:auto}.nav{height:82px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid var(--line)}.brand{display:flex;align-items:center;gap:11px;font-size:21px;font-weight:700;letter-spacing:-.035em}.mark{width:35px;height:35px;display:block}.links{display:flex;align-items:center;gap:24px}.links a{color:var(--ink);text-decoration:none;font-size:13px}.links .cta{background:var(--ink);color:var(--white);padding:12px 16px;border-radius:4px;font-weight:700}.hero{padding:108px 0 76px;display:grid;grid-template-columns:1.25fr .75fr;gap:68px;align-items:end}.eyebrow{display:inline-flex;align-items:center;gap:9px;font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.12em}.eyebrow:before{content:"";width:9px;height:9px;border-radius:50%;background:var(--signal)}h1,h2,h3,.big{font-family:Arial,Helvetica,sans-serif;font-weight:700}h1{font-size:clamp(58px,8vw,104px);line-height:.88;letter-spacing:-.075em;margin:22px 0 28px;max-width:900px}.signal{color:var(--signal)}.lead{font-size:19px;line-height:1.6;max-width:780px;color:#36342f}.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:30px}.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 17px;text-decoration:none;border-radius:4px;font-size:13px;font-weight:700}.primary{background:var(--signal);color:#fff}.secondary{border:1px solid var(--ink);color:var(--ink)}.hero-note{border-top:3px solid var(--ink);padding-top:18px}.hero-note .big{font-size:26px;letter-spacing:-.035em}.hero-note p{color:var(--muted);font-size:13px;line-height:1.65}.rail{background:var(--ink);color:#fff;padding:34px 0}.rail-grid{display:grid;grid-template-columns:repeat(7,auto);align-items:center;justify-content:space-between;gap:12px}.node{min-width:128px}.node small{display:block;color:#8d8980;font-size:9px;font-weight:700;letter-spacing:.11em;text-transform:uppercase;margin-bottom:7px}.node b{font-size:15px}.arrow{color:var(--signal);font-size:21px}.section{padding:92px 0;border-bottom:1px solid var(--line)}.kicker{font-size:11px;font-weight:700;letter-spacing:.12em;text-transform:uppercase;color:var(--signal)}h2{font-size:clamp(42px,5.7vw,70px);line-height:.98;letter-spacing:-.06em;margin:14px 0 20px;max-width:920px}.section>p,.intro{max-width:820px;color:var(--muted);font-size:16px;line-height:1.72}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:38px}.card{background:var(--paper);padding:28px;min-height:218px}.card .n{font-size:10px;font-weight:700;color:var(--signal);letter-spacing:.1em}.card h3{font-size:20px;margin:36px 0 12px;letter-spacing:-.035em}.card p{color:var(--muted);font-size:13px;line-height:1.65;margin:0}.dark{background:var(--panel);color:#fff}.dark .card{background:var(--panel);border-color:#343434}.dark .section{border-color:#343434}.dark .intro,.dark .card p{color:#aaa69d}.dark .grid{background:#343434;border-color:#343434}.code{margin-top:34px;border:1px solid #3a3a3a;background:#0c0c0c;padding:22px;overflow:auto;color:#e8e5dd;font:12px/1.85 Arial,Helvetica,sans-serif;white-space:pre-wrap}.code b{color:var(--signal)}.matrix{display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:38px}.matrix-box{border:1px solid var(--line);padding:26px}.matrix-box h3{margin:0 0 15px;font-size:22px;letter-spacing:-.035em}.tags{display:flex;gap:8px;flex-wrap:wrap}.tag{border:1px solid var(--line);padding:8px 10px;font-size:11px;font-weight:700;background:#fff}.truth{margin-top:24px;border-left:3px solid var(--signal);padding:12px 0 12px 17px;max-width:850px;color:var(--muted);font-size:13px;line-height:1.7}.pricing{display:grid;grid-template-columns:1fr 1fr;gap:1px;background:var(--line);border:1px solid var(--line);margin-top:34px}.price{background:var(--paper);padding:30px}.price strong{display:block;font-size:38px;letter-spacing:-.055em;margin:13px 0 10px}.price p{color:var(--muted);font-size:13px;line-height:1.65}.final{padding:86px 0}.final-box{background:var(--signal);color:#fff;padding:44px;display:flex;justify-content:space-between;align-items:end;gap:30px}.final h2{margin:0;max-width:760px}.final p{max-width:650px;line-height:1.6}.final .btn{background:#fff;color:#111}.footer{border-top:1px solid var(--line);padding:28px 0 38px;display:flex;justify-content:space-between;gap:20px;color:var(--muted);font-size:11px}.footer a{color:var(--ink);text-decoration:none;margin-left:16px}@media(max-width:900px){.hero{grid-template-columns:1fr}.rail-grid{grid-template-columns:1fr}.arrow{transform:rotate(90deg);padding:3px 0}.grid{grid-template-columns:1fr 1fr}.matrix{grid-template-columns:1fr}.links a:not(.cta){display:none}.final-box{display:block}.final .btn{margin-top:20px}}@media(max-width:600px){.wrap{width:min(100% - 24px,1180px)}.grid,.pricing{grid-template-columns:1fr}h1{font-size:54px}.hero{padding-top:68px}.footer{display:block}.footer div:last-child{margin-top:12px}.footer a{margin:0 12px 0 0}}
</style>
</head>
<body>
<div class="wrap">
<nav class="nav">
  <div class="brand"><img class="mark" src="${SITE}/logo.svg" alt="XGuard"><span>XGuard</span></div>
  <div class="links"><a href="#control">Control</a><a href="#protocols">Protocols</a><a href="#deploy">Deploy</a><a href="#pricing">Pricing</a><a class="cta" href="${API}/v1/actions">Machine API</a></div>
</nav>
<section class="hero">
  <div>
    <div class="eyebrow">Action Rail · protocol-neutral execution control</div>
    <h1>No side effect<br>without a <span class="signal">permit.</span></h1>
    <p class="lead">XGuard sits between AI agents and irreversible actions. Payments, purchases, bookings, messages, deployments, deletes, API writes and tool calls can be routed through one execution rail that enforces scope, budget, request binding, single-use execution and durable receipts.</p>
    <div class="actions"><a class="btn primary" href="${API}/v1/actions">Inspect Action Rail →</a><a class="btn secondary" href="https://github.com/moelayyan90/XGuard">GitHub</a><a class="btn secondary" href="${API}/mcp">MCP endpoint</a></div>
  </div>
  <aside class="hero-note"><div class="big">The useful chokepoint is execution.</div><p>A protocol can be replaced. An execution boundary is harder to remove after it becomes the place where authorization, replay control, budgets, receipts and audit evidence are enforced.</p></aside>
</section>
</div>
<div class="rail"><div class="wrap rail-grid"><div class="node"><small>01</small><b>Agent intent</b></div><div class="arrow">→</div><div class="node"><small>02</small><b>Scoped mandate</b></div><div class="arrow">→</div><div class="node"><small>03</small><b>Signed permit</b></div><div class="arrow">→</div><div class="node"><small>04</small><b>One execution + receipt</b></div></div></div>
<div class="wrap">
<section class="section" id="control">
  <span class="kicker">Why this exists</span>
  <h2>Agents need authority boundaries, not another optional scanner.</h2>
  <p class="intro">The Action Rail is designed for the moment an AI system changes something outside itself. The permit is cryptographically signed and bound to the action, protocol, target, HTTP method, exact request body hash, budget context and license. A permit that has started execution cannot be replayed as a second action.</p>
  <div class="grid">
    <article class="card"><span class="n">01 · SCOPE</span><h3>Delegated mandate</h3><p>Define the agent, allowed merchants, allowed action classes, per-action maximum, daily budget, maximum uses, expiry and revocation.</p></article>
    <article class="card"><span class="n">02 · BIND</span><h3>Exact request permit</h3><p>The permit binds target, method, action, protocol and request-body digest before execution. Changing any bound field invalidates the permit.</p></article>
    <article class="card"><span class="n">03 · ONCE</span><h3>Replay rejection</h3><p>Permit state moves atomically from issued to executing. A second attempt sees a non-executable state instead of becoming a duplicate action.</p></article>
    <article class="card"><span class="n">04 · FAILURE</span><h3>Ambiguity fails closed</h3><p>Transport failures and HTTP 5xx outcomes are treated as potentially ambiguous. XGuard does not automatically replay the action.</p></article>
    <article class="card"><span class="n">05 · DOWNSTREAM</span><h3>Idempotency hint</h3><p>When the target does not already provide an Idempotency-Key, XGuard injects the unique permit ID as one.</p></article>
    <article class="card"><span class="n">06 · EVIDENCE</span><h3>Durable receipt</h3><p>Known completed executions receive a durable XGuard action receipt and a final state that can be inspected later.</p></article>
  </div>
</section>
<section class="section" id="protocols">
  <span class="kicker">Above individual protocols</span>
  <h2>One execution boundary across agent commerce and tool use.</h2>
  <p class="intro">XGuard's existing transaction edge recognizes multiple agent and commerce wire surfaces. The Action Rail does not require every action to use x402; it can guard ordinary HTTPS side effects while retaining native x402 facilitator capabilities separately.</p>
  <div class="matrix">
    <div class="matrix-box"><h3>Recognized / routable surfaces</h3><div class="tags"><span class="tag">HTTP APIs</span><span class="tag">MCP tool calls</span><span class="tag">x402</span><span class="tag">MPP</span><span class="tag">AP2</span><span class="tag">ACP</span><span class="tag">UCP</span><span class="tag">TAP</span></div></div>
    <div class="matrix-box"><h3>Action classes</h3><div class="tags"><span class="tag">payment</span><span class="tag">purchase</span><span class="tag">booking</span><span class="tag">message</span><span class="tag">deploy</span><span class="tag">delete</span><span class="tag">create</span><span class="tag">update</span><span class="tag">tool_call</span></div></div>
  </div>
  <div class="truth"><b>Boundary:</b> XGuard becomes mandatory only where a service owner, agent operator, gateway or platform routes actions through it. XGuard does not claim the ability to force unrelated third-party traffic through its infrastructure.</div>
</section>
</div>
<div class="dark">
<div class="wrap">
<section class="section" id="deploy">
  <span class="kicker">Production path</span>
  <h2>Put XGuard where the action leaves the agent.</h2>
  <p class="intro">Use the hosted Action Rail directly, place XGuard Universal Gate in front of an origin, or integrate the execution permit into an existing agent/tool gateway. Docker and Kubernetes deployment remain available for traffic that must stay behind an operator-controlled boundary.</p>
  <div class="code"><b>1. Create a scoped mandate</b>
POST ${API}/v1/mandates

<b>2. Prepare one bound action</b>
POST ${API}/v1/actions/permits
X-XGuard-Key: &lt;usage-credit license&gt;
X-XGuard-Mandate: &lt;scoped mandate&gt;

{
  "target": "https://api.example.com/orders",
  "method": "POST",
  "action": "purchase",
  "protocol": "http",
  "amount_minor": "2500",
  "currency": "USD",
  "request_body": {"sku":"A-17","quantity":1}
}

<b>3. Execute exactly that signed request once</b>
POST ${API}/v1/actions/execute</div>
</section>
</div>
</div>
<div class="wrap">
<section class="section" id="pricing">
  <span class="kicker">Billing boundary</span>
  <h2>Charge the successful action, not the failed attempt.</h2>
  <div class="pricing">
    <div class="price"><span class="kicker">Action Rail</span><strong>1 Usage Credit</strong><p>Per successful 2xx/3xx Action Rail execution under the current production configuration. Balance is checked before execution and consumption occurs after successful upstream completion.</p></div>
    <div class="price"><span class="kicker">Failure states</span><strong>0 Credits</strong><p>Known failed actions and ambiguous Action Rail outcomes are not consumed as successful executions. Existing x402 settlement pricing remains a separate compatibility product.</p></div>
  </div>
  <div class="actions"><a class="btn primary" href="${checkout}">Get Usage Credits</a><a class="btn secondary" href="${API}/v1/actions/pricing">Machine-readable pricing</a></div>
</section>
<section class="final"><div class="final-box"><div><h2>Move the trust boundary in front of the action.</h2><p>Mandate → signed permit → one execution → receipt. Keep x402 when it is useful; do not make the product depend on x402 existing.</p></div><a class="btn" href="${API}/.well-known/xguard-actions.json">Open manifest →</a></div></section>
<footer class="footer"><div>© XGuard · protocol-neutral AI action control</div><div><a href="${API}/openapi.json">OpenAPI</a><a href="${API}/llms.txt">llms.txt</a><a href="${API}/skill.md">skill.md</a><a href="${SITE}/.well-known/security.txt">Security</a></div></footer>
</div>
</body>
</html>`;

  return new Response(request.method === "HEAD" ? null : html, {
    status: 200,
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=60",
      "content-security-policy": "default-src 'self'; img-src 'self'; style-src 'unsafe-inline'; script-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
      "x-frame-options": "DENY",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
    },
  });
}

export default {
  async fetch(request, env) {
    if (!["GET", "HEAD"].includes(request.method)) return null;
    if (new URL(request.url).pathname !== "/") return null;
    return page(request, env);
  },
};
