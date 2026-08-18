const CACHE = "public, max-age=30, stale-while-revalidate=60";

export function buyerPortalResponse(request: Request): Response | null {
  if (request.method !== "GET" && request.method !== "HEAD") return null;
  const url = new URL(request.url);
  if (url.pathname === "/") {
    const accept = request.headers.get("accept") ?? "";
    if (!accept.includes("text/html")) return null;
    return html(request, landing(url.origin));
  }
  if (url.pathname === "/payment" || url.pathname === "/payment-decision")
    return html(request, paymentPage(url.origin));
  if (url.pathname === "/security")
    return html(request, securityPage(url.origin));
  return null;
}

function shell(origin: string, title: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f7f9f9">
<title>${escapeHtml(title)}</title>
<meta name="description" content="XGuard is an independent payment decision and transaction-evidence layer for people and autonomous agents.">
<link rel="icon" href="/favicon.svg?v=20260818" type="image/svg+xml">
<style>${styles()}</style>
</head>
<body>
<header class="site-header">
  <div class="nav-shell">
    <a class="brand" href="/" aria-label="XGuard home"><img src="/favicon.svg?v=20260818" alt="" width="31" height="31"><b>XGUARD</b></a>
    <nav aria-label="Primary navigation"><a href="/payment">Payment Decision</a><a href="/security">Security</a><a href="/status">Status</a><a href="/docs">Docs</a></nav>
    <a class="nav-cta" href="/docs">Build with XGuard <span>↗</span></a>
  </div>
</header>
${body}
<footer class="site-footer">
  <div class="footer-main"><a class="brand footer-brand" href="/"><img src="/favicon.svg?v=20260818" alt="" width="28" height="28"><b>XGUARD</b></a><p>Independent payment decision & evidence.</p></div>
  <div class="footer-links"><a href="${origin}/.well-known/xguard-payment.json">Machine manifest</a><a href="${origin}/mcp">MCP</a><a href="/docs">Developer docs</a></div>
</footer>
</body></html>`;
}

function landing(origin: string): string {
  return shell(
    origin,
    "XGuard — Payment intelligence before money moves",
    `<main>
<section class="hero-section">
  <div class="hero-glow hero-glow-one"></div><div class="hero-glow hero-glow-two"></div>
  <div class="container hero">
    <div class="hero-copy">
      <div class="pill"><span class="pill-dot"></span>Payment intelligence · Buyer + Agent side</div>
      <h1>Know what you are paying.<br><span>Before money moves.</span></h1>
      <p class="hero-lead">XGuard adds an independent decision layer at payment time. Verify the declared amount, destination, route and intent — then keep a durable evidence record of what was checked.</p>
      <div class="hero-actions"><a class="button primary" href="/payment">Explore payment decision</a><a class="button ghost" href="/docs">Read the docs <span>→</span></a></div>
      <div class="hero-proof"><span><b>Free</b> to show</span><span><b>Free</b> to skip</span><span><b>Charged</b> only after a completed result</span></div>
    </div>
    <div class="product-stage" aria-label="XGuard payment decision preview">
      <div class="stage-grid"></div>
      <div class="merchant-card floating-card">
        <div class="card-kicker"><span class="status-dot"></span>PAYMENT DETECTED</div>
        <div class="merchant-head"><div><span>Merchant</span><strong>Acme Tools</strong></div><div class="amount-mini">$129.00</div></div>
        <div class="merchant-meta"><span>Stripe</span><span>USD</span><span>acme.example</span></div>
      </div>
      <div class="decision-card floating-card">
        <div class="decision-brand"><img src="/favicon.svg?v=20260818" alt="" width="34" height="34"><div><b>XGuard Decision</b><span>Independent pre-payment check</span></div></div>
        <div class="decision-result"><span class="result-icon">✓</span><div><small>DECISION</small><strong>ALLOW</strong></div><em>High confidence</em></div>
        <div class="check-list"><span><i>✓</i> Amount matches declared intent</span><span><i>✓</i> Destination is consistent</span><span><i>✓</i> Payment route is recognized</span></div>
        <div class="hash-row"><span>Evidence</span><code>sha256 · 8f4c…2da9</code></div>
      </div>
      <div class="stage-label">XGUARD / PAYMENT EXECUTION SAFETY</div>
    </div>
  </div>
</section>

<section class="signal-strip">
  <div class="container signal-grid"><div><span>Designed for</span><strong>Buyers</strong></div><div><span>Works with</span><strong>Agents</strong></div><div><span>Machine surface</span><strong>MCP + API</strong></div><div><span>Settlement adapter</span><strong>x402 + others</strong></div></div>
</section>

<section class="container section intro-section">
  <div class="section-heading"><span class="eyebrow">THE DECISION LAYER</span><h2>A calm surface around the highest-risk moment.</h2></div>
  <p class="section-lead">XGuard does not replace the merchant checkout or hold payment credentials. It sits beside the transaction, checks the facts that can be checked, and returns an explicit result with reasons and evidence.</p>
</section>

<section class="container feature-grid">
  <article class="feature feature-large"><div class="feature-top"><span class="feature-index">01</span><span class="feature-tag">BEFORE PAYMENT</span></div><h3>See the transaction before you commit.</h3><p>Surface the declared amount, merchant, route and destination in one clean decision step before the underlying payment continues.</p><div class="mini-ui"><div><span>Amount</span><b>$129.00 USD</b></div><div><span>Destination</span><b>acme.example</b></div><div><span>Route</span><b>Stripe</b></div></div></article>
  <article class="feature"><div class="feature-top"><span class="feature-index">02</span><span class="feature-tag">REASONS</span></div><h3>ALLOW, REVIEW or BLOCK — with context.</h3><p>A result is accompanied by machine-readable reason codes, coverage limits and checks instead of a vague trust badge.</p><div class="decision-pills"><span class="allow">ALLOW</span><span class="review">REVIEW</span><span class="block">BLOCK</span></div></article>
  <article class="feature"><div class="feature-top"><span class="feature-index">03</span><span class="feature-tag">EVIDENCE</span></div><h3>One durable record for the transaction.</h3><p>Start the record before payment and complete it with settlement state and provider reference after payment — without a second XGuard fee.</p><div class="record-line"><span>decision_id</span><code>xg_7f3…91a</code></div><div class="record-line"><span>status</span><code>completed</code></div></article>
</section>

<section class="dark-section">
  <div class="container dark-layout">
    <div class="dark-copy"><span class="eyebrow light">HOW IT WORKS</span><h2>One request in.<br>One decision out.</h2><p>The integration stays deliberately simple. Human-facing surfaces and autonomous agents can use the same underlying decision contract.</p><a class="button light-button" href="/docs">Open developer docs <span>→</span></a></div>
    <div class="flow-window">
      <div class="window-bar"><span></span><span></span><span></span><code>xguardgate.com</code></div>
      <div class="flow-row"><b>01</b><div><span>Payment intent</span><small>Amount · merchant · route · destination</small></div><em>INPUT</em></div>
      <div class="flow-row active"><b>02</b><div><span>XGuard decision</span><small>Checks · reasons · confidence · evidence hash</small></div><em>VERIFY</em></div>
      <div class="flow-row"><b>03</b><div><span>Pay or cancel</span><small>The original payment rail continues normally</small></div><em>OUTCOME</em></div>
      <div class="code-line"><span>POST</span><code>${origin}/v1/payment/decision</code></div>
    </div>
  </div>
</section>

<section class="container section security-section">
  <div class="section-heading"><span class="eyebrow">SECURITY EVIDENCE</span><h2>Proof over adjectives.</h2></div>
  <div class="security-copy"><p>Security claims are tied to commit-bound checks: type safety, lint, dependency audit, secret scanning, decision tests, replay and idempotency assertions, and privacy checks.</p><a class="text-link" href="/security">Inspect security evidence <span>→</span></a></div>
  <div class="security-cards"><article><span>STATIC</span><strong>Type safety + lint</strong><small>Must pass before release</small></article><article><span>ECONOMIC</span><strong>Fee invariants</strong><small>Idempotent billing boundaries</small></article><article><span>PRIVACY</span><strong>Credential rejection</strong><small>No raw card or secret fields</small></article></div>
</section>

<section class="container final-cta"><div><span class="eyebrow">START HERE</span><h2>Put a decision layer before payment.</h2><p>Use the human-facing flow, the API, or MCP — without replacing the underlying payment rail.</p></div><div class="final-actions"><a class="button primary" href="/docs">Build with XGuard</a><a class="button ghost" href="/payment">See payment flow</a></div></section>
</main>`,
  );
}

function paymentPage(origin: string): string {
  return shell(
    origin,
    "XGuard Payment Decision",
    `<main>
<section class="page-hero"><div class="container"><div class="pill"><span class="pill-dot"></span>PAYMENT DECISION</div><h1>A free offer.<br><span>A paid result only when the job is complete.</span></h1><p class="hero-lead narrow">Showing XGuard does not charge. Declining XGuard does not charge. An XGuard service failure does not charge. A fee is earned only after the requested decision and durable evidence record are completed.</p></div></section>
<section class="container page-section"><div class="section-heading"><span class="eyebrow">ECONOMIC BOUNDARY</span><h2>Five clear states. No hidden transition.</h2></div><div class="timeline"><div><b>01</b><span>Payment intent detected</span><small>Free</small></div><div><b>02</b><span>XGuard offered</span><small>Free</small></div><div class="active"><b>03</b><span>Buyer / agent opts in</span><small>Fee authorized</small></div><div><b>04</b><span>Checks + evidence complete</span><small>Fee earned</small></div><div><b>05</b><span>Pay or cancel</span><small>No second fee</small></div></div></section>
<section class="container split-section"><div><span class="eyebrow">MACHINE SURFACES</span><h2>One contract for humans and agents.</h2><p>Use the same decision boundary through the public API or MCP.</p></div><div class="api-panel"><code><span>POST</span>${origin}/v1/payment/offer</code><code><span>POST</span>${origin}/v1/payment/decision</code><code><span>GET</span>${origin}/v1/payment/records/{decisionId}</code><code><span>POST</span>${origin}/v1/payment/records/{decisionId}/settlement</code><code><span>POST</span>${origin}/mcp</code></div></section>
<section class="container privacy-panel"><div><span class="eyebrow">PRIVACY BOUNDARY</span><h2>Transaction facts, never payment credentials.</h2></div><p>XGuard's payment-decision API rejects fields that look like raw card numbers, PAN, CVV/CVC, PIN, private keys, seed phrases or mnemonics. Buyer surfaces should send declared transaction facts only.</p></section>
</main>`,
  );
}

function securityPage(origin: string): string {
  return shell(
    origin,
    "XGuard Security Evidence",
    `<main>
<section class="page-hero"><div class="container"><div class="pill"><span class="pill-dot"></span>MEASURABLE SECURITY</div><h1>Evidence,<br><span>not adjectives.</span></h1><p class="hero-lead narrow">XGuard does not publish “100% secure” claims. Payment Decision changes are gated by machine-verifiable checks bound to source commits.</p></div></section>
<section class="container page-section"><div class="section-heading"><span class="eyebrow">RELEASE GATES</span><h2>Security is a set of checks that must pass.</h2></div><div class="evidence-grid"><article><span>STATIC</span><h3>Type safety + lint</h3><p>TypeScript and ESLint must complete without errors.</p></article><article><span>SUPPLY CHAIN</span><h3>Dependency audit</h3><p>High-severity npm audit findings fail the evidence gate.</p></article><article><span>SECRETS</span><h3>Repository scan</h3><p>The project secret scanner must pass on the same commit.</p></article><article><span>ECONOMIC</span><h3>Fee invariants</h3><p>Offer and skip are non-billable; request IDs are idempotent; a completed decision is charged once.</p></article><article><span>INPUT</span><h3>Credential rejection</h3><p>Raw card, PAN, CVV and private-key shaped fields are rejected by the decision boundary.</p></article><article><span>PRIVACY</span><h3>Buyer surface</h3><p>The browser client does not transmit checkout context until the user explicitly chooses XGuard.</p></article></div></section>
<section class="container final-cta security-cta"><div><span class="eyebrow">VERIFY IT YOURSELF</span><h2>Inspect the machine-readable evidence.</h2></div><div class="final-actions"><a class="button primary" href="${origin}/.well-known/xguard-security-evidence.json">Open policy</a><a class="button ghost" href="https://github.com/moelayyan90/XGuard/actions/workflows/payment-security-evidence.yml">View CI evidence <span>↗</span></a></div></section>
</main>`,
  );
}

function html(request: Request, value: string): Response {
  return new Response(request.method === "HEAD" ? null : value, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": CACHE,
      "Referrer-Policy": "no-referrer",
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy":
        "default-src 'self'; img-src 'self' data:; style-src 'unsafe-inline'; script-src 'none'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}

function styles(): string {
  return `:root{color-scheme:light;--bg:#f7f9f9;--paper:#fff;--paper-2:#f2f5f5;--ink:#12191d;--muted:#69767b;--subtle:#98a3a7;--line:#e2e8e9;--line-strong:#d2dcde;--teal:#5db5bf;--teal-deep:#397b83;--teal-pale:#e8f7f8;--silver:#b9c1c5;--dark:#111719;--dark-2:#172024;--dark-line:#2b363b;--shadow:0 28px 80px rgba(29,48,54,.10);--shadow-soft:0 12px 40px rgba(29,48,54,.07)}*{box-sizing:border-box}html{scroll-behavior:smooth;background:var(--bg);color:var(--ink);font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;-webkit-font-smoothing:antialiased}body{margin:0;background:#fff}a{color:inherit;text-decoration:none}button,input{font:inherit}.container{width:min(1180px,calc(100% - 48px));margin-inline:auto}.site-header{position:sticky;top:0;z-index:40;border-bottom:1px solid rgba(226,232,233,.85);background:rgba(255,255,255,.88);backdrop-filter:blur(18px)}.nav-shell{width:min(1180px,calc(100% - 48px));height:70px;margin:auto;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:28px}.brand{display:inline-flex;align-items:center;gap:10px;width:max-content}.brand img{display:block}.brand b{font-size:13px;letter-spacing:.14em}.nav-shell nav{display:flex;align-items:center;gap:28px;color:#5f6d72;font-size:13px;font-weight:620}.nav-shell nav a:hover,.footer-links a:hover{color:var(--teal-deep)}.nav-cta{justify-self:end;display:inline-flex;align-items:center;gap:7px;border:1px solid var(--line-strong);border-radius:9px;padding:9px 13px;background:#fff;font-size:12px;font-weight:700;box-shadow:0 4px 14px rgba(29,48,54,.04)}.nav-cta:hover{border-color:#b8cbce;background:#fbfdfd}.hero-section{position:relative;overflow:hidden;background:linear-gradient(180deg,#fbfdfd 0%,#f6f9f9 70%,#fff 100%)}.hero-glow{position:absolute;border-radius:999px;filter:blur(1px);pointer-events:none}.hero-glow-one{width:540px;height:540px;right:-190px;top:-170px;background:radial-gradient(circle,rgba(93,181,191,.15),rgba(93,181,191,0) 68%)}.hero-glow-two{width:430px;height:430px;left:-220px;bottom:-220px;background:radial-gradient(circle,rgba(185,193,197,.18),rgba(185,193,197,0) 70%)}.hero{position:relative;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(430px,.95fr);gap:76px;align-items:center;padding:112px 0 104px}.hero-copy{min-width:0}.pill{display:inline-flex;align-items:center;gap:9px;border:1px solid var(--line);border-radius:999px;background:rgba(255,255,255,.78);padding:8px 12px;color:#5c6b70;font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.08em;box-shadow:0 8px 24px rgba(31,55,61,.04)}.pill-dot{width:7px;height:7px;border-radius:50%;background:var(--teal);box-shadow:0 0 0 4px rgba(93,181,191,.13)}h1,h2,h3,p{margin-top:0}.hero h1,.page-hero h1{margin:26px 0 24px;max-width:850px;font-size:clamp(55px,6.7vw,86px);line-height:.96;letter-spacing:-.058em;font-weight:720}.hero h1 span,.page-hero h1 span{color:#8f9a9e}.hero-lead{max-width:720px;margin:0;color:var(--muted);font-size:19px;line-height:1.7;letter-spacing:-.01em}.narrow{max-width:820px}.hero-actions,.final-actions{display:flex;align-items:center;gap:11px;flex-wrap:wrap;margin-top:34px}.button{display:inline-flex;align-items:center;justify-content:center;gap:8px;min-height:45px;padding:0 17px;border-radius:9px;font-size:13px;font-weight:720;transition:.18s ease}.button.primary{background:var(--ink);color:#fff;border:1px solid var(--ink);box-shadow:0 8px 22px rgba(18,25,29,.12)}.button.primary:hover{transform:translateY(-1px);background:#253238}.button.ghost{border:1px solid var(--line-strong);background:#fff;color:#4e5d62}.button.ghost:hover{border-color:#b3c8cb;color:var(--teal-deep)}.hero-proof{display:flex;gap:24px;flex-wrap:wrap;margin-top:38px;color:#7b888d;font-size:11px}.hero-proof span{display:flex;align-items:center;gap:6px}.hero-proof b{color:#435157;font-weight:740}.product-stage{position:relative;min-height:560px;border:1px solid var(--line);border-radius:28px;background:linear-gradient(145deg,#eef4f4,#f9fbfb 48%,#edf5f5);box-shadow:var(--shadow);overflow:hidden}.stage-grid{position:absolute;inset:0;background-image:linear-gradient(rgba(88,113,120,.06) 1px,transparent 1px),linear-gradient(90deg,rgba(88,113,120,.06) 1px,transparent 1px);background-size:34px 34px;mask-image:linear-gradient(to bottom,#000,transparent 88%)}.floating-card{position:absolute;border:1px solid rgba(210,220,222,.95);background:rgba(255,255,255,.92);box-shadow:0 24px 60px rgba(45,68,74,.12);backdrop-filter:blur(18px)}.merchant-card{top:76px;left:48px;right:84px;border-radius:16px;padding:22px;transform:rotate(-2deg)}.card-kicker{display:flex;align-items:center;gap:8px;color:#7b888d;font:700 9px ui-monospace,monospace;letter-spacing:.11em}.status-dot{width:7px;height:7px;border-radius:50%;background:#68b88b}.merchant-head{display:flex;align-items:end;justify-content:space-between;gap:20px;margin-top:30px}.merchant-head>div:first-child{display:grid;gap:5px}.merchant-head span{font-size:11px;color:var(--subtle)}.merchant-head strong{font-size:21px;letter-spacing:-.025em}.amount-mini{font-size:28px;font-weight:700;letter-spacing:-.04em}.merchant-meta{display:flex;gap:8px;flex-wrap:wrap;margin-top:22px}.merchant-meta span{border:1px solid var(--line);border-radius:999px;padding:6px 9px;color:#66757a;background:#fbfcfc;font-size:10px}.decision-card{left:92px;right:42px;bottom:64px;border-radius:18px;padding:22px;transform:rotate(1.5deg)}.decision-brand{display:flex;align-items:center;gap:11px}.decision-brand>div{display:grid;gap:2px}.decision-brand b{font-size:13px}.decision-brand span{font-size:10px;color:var(--muted)}.decision-result{display:grid;grid-template-columns:auto 1fr auto;align-items:center;gap:12px;margin:21px 0 18px;padding:17px;border:1px solid #cce7dc;border-radius:12px;background:#f3fbf7}.result-icon{display:grid;place-items:center;width:31px;height:31px;border-radius:50%;background:#58a97e;color:#fff;font-weight:800}.decision-result>div{display:grid}.decision-result small{font:700 8px ui-monospace,monospace;color:#7d8b84;letter-spacing:.1em}.decision-result strong{font-size:16px;color:#276745}.decision-result em{font-style:normal;color:#5b7266;font-size:10px}.check-list{display:grid;gap:10px}.check-list span{font-size:11px;color:#526166}.check-list i{font-style:normal;color:#4c9a71;margin-right:8px}.hash-row{display:flex;justify-content:space-between;gap:16px;margin-top:18px;padding-top:14px;border-top:1px solid var(--line);font-size:9px;color:var(--subtle)}.hash-row code{font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.stage-label{position:absolute;right:19px;top:50%;transform:rotate(90deg) translateX(50%);transform-origin:right center;color:#9fa9ac;font:700 8px ui-monospace,monospace;letter-spacing:.18em}.signal-strip{border-block:1px solid var(--line);background:#fff}.signal-grid{display:grid;grid-template-columns:repeat(4,1fr)}.signal-grid div{display:grid;gap:3px;padding:20px 22px;border-right:1px solid var(--line)}.signal-grid div:first-child{padding-left:0}.signal-grid div:last-child{border-right:0}.signal-grid span{font-size:10px;color:var(--subtle)}.signal-grid strong{font-size:13px;font-weight:700}.section{padding-top:112px}.intro-section{display:grid;grid-template-columns:1fr .78fr;gap:100px;align-items:end}.section-heading{max-width:710px}.eyebrow{display:block;margin-bottom:16px;color:var(--teal-deep);font:750 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.13em}.eyebrow.light{color:#7fc6cd}.section-heading h2,.dark-copy h2,.split-section h2,.privacy-panel h2,.final-cta h2{margin-bottom:0;font-size:clamp(38px,4.7vw,58px);line-height:1.03;letter-spacing:-.048em;font-weight:680}.section-lead,.security-copy p,.split-section p,.privacy-panel p,.final-cta p,.dark-copy p{margin:0;color:var(--muted);font-size:16px;line-height:1.7}.feature-grid{display:grid;grid-template-columns:1.15fr .85fr;gap:16px;padding-top:50px;padding-bottom:118px}.feature{min-height:370px;border:1px solid var(--line);border-radius:20px;padding:28px;background:#fff;box-shadow:var(--shadow-soft)}.feature-large{grid-row:span 2;min-height:756px;background:linear-gradient(180deg,#fff,#f8fbfb)}.feature-top{display:flex;align-items:center;justify-content:space-between;gap:12px}.feature-index{color:#a0aaad;font:650 10px ui-monospace,monospace}.feature-tag{border:1px solid var(--line);border-radius:999px;padding:6px 8px;color:#7a878c;background:#fafcfc;font:700 8px ui-monospace,monospace;letter-spacing:.08em}.feature h3{max-width:460px;margin:70px 0 13px;font-size:31px;line-height:1.07;letter-spacing:-.04em;font-weight:660}.feature:not(.feature-large) h3{margin-top:48px;font-size:26px}.feature p{max-width:520px;margin-bottom:0;color:var(--muted);font-size:14px;line-height:1.7}.mini-ui{margin-top:74px;border:1px solid var(--line);border-radius:14px;overflow:hidden;background:#fff}.mini-ui div{display:flex;align-items:center;justify-content:space-between;gap:20px;padding:17px;border-bottom:1px solid var(--line)}.mini-ui div:last-child{border-bottom:0}.mini-ui span{color:var(--subtle);font-size:11px}.mini-ui b{font-size:12px}.decision-pills{display:flex;gap:8px;margin-top:52px}.decision-pills span{border-radius:8px;padding:9px 11px;font:750 9px ui-monospace,monospace}.decision-pills .allow{background:#edf8f2;color:#347453}.decision-pills .review{background:#fff7e8;color:#9a6c20}.decision-pills .block{background:#fff0f0;color:#9c4f4f}.record-line{display:flex;justify-content:space-between;gap:16px;padding:14px 0;border-bottom:1px solid var(--line);font-size:10px}.record-line:first-of-type{margin-top:34px;border-top:1px solid var(--line)}.record-line span{color:var(--subtle)}.record-line code{font-family:ui-monospace,monospace;color:#56666b}.dark-section{background:var(--dark);color:#f5f8f8;padding:112px 0;border-block:1px solid #0b1012}.dark-layout{display:grid;grid-template-columns:.78fr 1.22fr;gap:90px;align-items:center}.dark-copy h2{margin-bottom:22px;color:#fff}.dark-copy p{color:#9faeb3;max-width:470px}.light-button{margin-top:32px;background:#f5f8f8;color:#172024;border:1px solid #f5f8f8}.light-button:hover{background:#fff}.flow-window{border:1px solid var(--dark-line);border-radius:18px;background:var(--dark-2);overflow:hidden;box-shadow:0 26px 80px rgba(0,0,0,.22)}.window-bar{display:flex;align-items:center;gap:7px;padding:14px 16px;border-bottom:1px solid var(--dark-line);background:#131b1e}.window-bar>span{width:7px;height:7px;border-radius:50%;background:#49575c}.window-bar code{margin-left:9px;color:#74848a;font:9px ui-monospace,monospace}.flow-row{display:grid;grid-template-columns:42px 1fr auto;gap:16px;align-items:center;padding:22px;border-bottom:1px solid var(--dark-line)}.flow-row b{color:#66777d;font:700 10px ui-monospace,monospace}.flow-row>div{display:grid;gap:4px}.flow-row span{font-size:13px;font-weight:700}.flow-row small{color:#78898f;font-size:10px}.flow-row em{font-style:normal;color:#708086;font:700 8px ui-monospace,monospace;letter-spacing:.1em}.flow-row.active{background:linear-gradient(90deg,rgba(93,181,191,.12),rgba(93,181,191,.02))}.flow-row.active b,.flow-row.active em{color:#74c5cd}.code-line{display:flex;gap:13px;padding:16px 22px;background:#101719}.code-line span{color:#78c7ce;font:750 9px ui-monospace,monospace}.code-line code{color:#a8b7bc;font:10px ui-monospace,monospace}.security-section{display:grid;grid-template-columns:1fr 1fr;gap:60px 80px;padding-bottom:112px}.security-copy{align-self:end}.text-link{display:inline-flex;gap:7px;margin-top:24px;color:var(--teal-deep);font-size:12px;font-weight:720}.security-cards{grid-column:1/-1;display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.security-cards article{display:grid;gap:9px;padding:24px;border:1px solid var(--line);border-radius:14px;background:#fff}.security-cards span{color:var(--teal-deep);font:750 8px ui-monospace,monospace;letter-spacing:.1em}.security-cards strong{font-size:15px}.security-cards small{color:var(--subtle);font-size:10px}.final-cta{display:grid;grid-template-columns:1fr auto;gap:60px;align-items:end;margin-bottom:96px;padding:50px;border:1px solid var(--line);border-radius:22px;background:linear-gradient(135deg,#f5f9f9,#fbfdfd);box-shadow:var(--shadow-soft)}.final-cta h2{font-size:42px}.final-cta p{margin-top:14px;max-width:650px}.final-actions{justify-content:flex-end;margin-top:0}.page-hero{padding:102px 0 90px;background:linear-gradient(180deg,#fbfdfd,#f5f8f8);border-bottom:1px solid var(--line)}.page-hero h1{max-width:980px}.page-section{padding:100px 0}.timeline{margin-top:54px;border-top:1px solid var(--line)}.timeline div{display:grid;grid-template-columns:58px 1fr auto;gap:18px;align-items:center;padding:22px 0;border-bottom:1px solid var(--line)}.timeline b{color:#a1abad;font:700 10px ui-monospace,monospace}.timeline span{font-size:15px;font-weight:660}.timeline small{color:var(--muted);font-size:11px}.timeline .active{margin-inline:-18px;padding-inline:18px;border:1px solid #cfe5e7;border-radius:12px;background:#f4fbfb}.timeline .active b,.timeline .active small{color:var(--teal-deep)}.split-section{display:grid;grid-template-columns:.8fr 1.2fr;gap:80px;align-items:start;padding:16px 0 100px}.split-section h2{font-size:43px;margin-bottom:18px}.api-panel{border:1px solid var(--line);border-radius:16px;background:#12191d;padding:10px 18px;box-shadow:var(--shadow-soft)}.api-panel code{display:grid;grid-template-columns:54px 1fr;gap:14px;padding:15px 0;border-bottom:1px solid #293338;color:#b3c0c4;font:10px ui-monospace,monospace;overflow:auto}.api-panel code:last-child{border-bottom:0}.api-panel code span{color:#74c3ca;font-weight:750}.privacy-panel{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-bottom:100px;padding:44px;border:1px solid var(--line);border-radius:20px;background:#f7fafa}.privacy-panel h2{font-size:38px}.privacy-panel p{align-self:end}.evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin-top:54px}.evidence-grid article{min-height:210px;border:1px solid var(--line);border-radius:16px;padding:25px;background:#fff;box-shadow:var(--shadow-soft)}.evidence-grid article span{color:var(--teal-deep);font:750 8px ui-monospace,monospace;letter-spacing:.1em}.evidence-grid h3{margin:48px 0 10px;font-size:21px;letter-spacing:-.025em}.evidence-grid p{margin:0;color:var(--muted);font-size:13px;line-height:1.65}.security-cta{margin-top:10px}.site-footer{width:min(1180px,calc(100% - 48px));margin:auto;padding:30px 0 38px;border-top:1px solid var(--line);display:flex;justify-content:space-between;gap:30px;color:var(--muted);font-size:11px}.footer-main{display:flex;align-items:center;gap:20px}.footer-main p{margin:0}.footer-brand b{font-size:11px}.footer-links{display:flex;align-items:center;gap:20px}@media(max-width:980px){.nav-shell{grid-template-columns:1fr auto}.nav-shell nav{display:none}.hero{grid-template-columns:1fr;gap:50px}.product-stage{max-width:680px;width:100%;margin-inline:auto}.intro-section,.security-section,.split-section,.privacy-panel{grid-template-columns:1fr;gap:32px}.feature-grid{grid-template-columns:1fr}.feature-large{grid-row:auto;min-height:620px}.dark-layout{grid-template-columns:1fr;gap:50px}.security-cards{grid-template-columns:1fr 1fr}.final-cta{grid-template-columns:1fr;align-items:start}.final-actions{justify-content:flex-start}.evidence-grid{grid-template-columns:1fr 1fr}}@media(max-width:680px){.container,.nav-shell,.site-footer{width:min(100% - 28px,1180px)}.nav-shell{height:62px}.nav-cta{font-size:0;padding:9px 11px}.nav-cta span{font-size:13px}.hero{padding:74px 0 68px}.hero h1,.page-hero h1{font-size:48px}.hero-lead{font-size:16px}.hero-proof{gap:12px 18px}.product-stage{min-height:470px;border-radius:20px}.merchant-card{top:46px;left:18px;right:38px;padding:17px}.decision-card{left:34px;right:18px;bottom:42px;padding:17px}.amount-mini{font-size:22px}.stage-label{display:none}.signal-grid{grid-template-columns:1fr 1fr}.signal-grid div:nth-child(2){border-right:0}.signal-grid div:nth-child(-n+2){border-bottom:1px solid var(--line)}.signal-grid div:nth-child(3){padding-left:0}.section{padding-top:78px}.intro-section{gap:26px}.section-heading h2,.dark-copy h2,.final-cta h2{font-size:39px}.feature-grid{padding-top:34px;padding-bottom:78px}.feature,.feature-large{min-height:auto;padding:22px}.feature h3,.feature:not(.feature-large) h3{margin-top:42px;font-size:25px}.mini-ui{margin-top:42px}.dark-section{padding:78px 0}.flow-row{grid-template-columns:34px 1fr}.flow-row em{grid-column:2}.security-section{padding-bottom:78px}.security-cards,.evidence-grid{grid-template-columns:1fr}.final-cta{padding:28px;margin-bottom:70px}.page-hero{padding:72px 0 62px}.page-section{padding:72px 0}.timeline div{grid-template-columns:38px 1fr}.timeline small{grid-column:2}.split-section{padding-bottom:72px}.privacy-panel{padding:28px;margin-bottom:72px}.site-footer{flex-direction:column;align-items:flex-start}.footer-main{align-items:flex-start;flex-direction:column;gap:12px}.footer-links{flex-wrap:wrap;gap:12px 18px}}@media(prefers-reduced-motion:no-preference){.floating-card{transition:transform .25s ease}.product-stage:hover .merchant-card{transform:rotate(-1deg) translateY(-4px)}.product-stage:hover .decision-card{transform:rotate(.6deg) translateY(-6px)}}`;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#039;",
      })[character] ?? character,
  );
}
