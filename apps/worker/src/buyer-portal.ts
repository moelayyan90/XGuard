const CACHE = "public, max-age=120, stale-while-revalidate=600";

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
<meta name="theme-color" content="#f5f8f8">
<title>${escapeHtml(title)}</title>
<meta name="description" content="XGuard is an optional pre-payment decision and transaction-evidence layer for people and autonomous agents.">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<style>${styles()}</style>
</head>
<body>
<header><a class="brand" href="/"><img src="/favicon.svg" alt="" width="34" height="34"><b>XGUARD</b></a><nav><a href="/payment">Payment Decision</a><a href="/security">Security Evidence</a><a href="/status">Status</a><a href="/docs">Developer Docs</a></nav></header>
${body}
<footer><div><a class="brand footer-brand" href="/"><img src="/favicon.svg" alt="" width="28" height="28"><b>XGUARD</b></a><span>Independent payment decision & evidence.</span></div><div><a href="${origin}/.well-known/xguard-payment.json">Machine manifest</a><a href="${origin}/mcp">MCP</a></div></footer>
</body></html>`;
}

function landing(origin: string): string {
  return shell(
    origin,
    "XGuard — Verify the payment before it leaves",
    `<main>
<section class="hero-wrap">
  <div class="hero">
    <div class="hero-copy">
      <div class="eyebrow">PAYMENT DECISION / BUYER + AGENT SIDE</div>
      <h1>Know what you are paying.<br><span>Before the money moves.</span></h1>
      <p class="lead">XGuard can appear at the moment of payment as an optional verification step. Skip it and pay normally, or use it to verify the declared transaction and create an independent evidence record before continuing.</p>
      <div class="actions"><a class="primary" href="/payment">See how it works</a><a class="secondary" href="/security">Verify our evidence</a></div>
      <div class="truth"><span>Offer = $0</span><span>Skip = $0</span><span>Fee only after a completed XGuard result</span></div>
    </div>
    <div class="hero-mark"><img src="/logo.svg" alt="XGuard"><small>PAYMENT EXECUTION SAFETY</small></div>
  </div>
</section>
<section class="demo" aria-label="Example XGuard payment offer">
  <div class="checkout"><small>PAYMENT DETECTED</small><div class="merchant">Acme Tools</div><div class="amount">$129.00 <span>USD</span></div><div class="line"><span>Payment provider</span><b>Stripe</b></div><div class="line"><span>Destination</span><b>acme.example</b></div></div>
  <div class="guard-card"><div class="guard-top"><img src="/favicon.svg" alt="" width="40" height="40"><div><b>Check this payment with XGuard?</b><span>Optional · before payment</span></div></div><p>Verify amount, destination, payment route and declared intent. Create an independent transaction record with evidence.</p><button>Use XGuard</button><a>Continue without XGuard</a><small>No fee is created by this offer.</small></div>
</section>
<section class="grid">
  <article><i>01</i><h2>Appears at payment time</h2><p>A browser-side surface can detect a high-confidence checkout context. Agent runtimes can discover the XGuard payment tools through MCP.</p></article>
  <article><i>02</i><h2>Decision with reasons</h2><p>ALLOW, REVIEW or BLOCK is accompanied by machine-readable checks, reason codes, coverage limits and a SHA-256 evidence hash.</p></article>
  <article><i>03</i><h2>One transaction record</h2><p>The record starts before payment and can be completed with settlement status and provider reference afterward, without a second XGuard fee.</p></article>
</section>
<section class="band"><div><div class="eyebrow">UNIVERSAL INTENT</div><h2>x402 is an adapter now, not the product boundary.</h2></div><p>The decision API accepts declared payment intents independently of a settlement rail. Known rails receive rail-aware checks; unknown rails are handled with explicit reduced-coverage evidence instead of a fake guarantee.</p></section>
<section class="proof"><div><div class="eyebrow">SECURITY EVIDENCE</div><h2>No decorative security badges.</h2></div><div><p>Security claims are tied to commit-bound CI results: typecheck, lint, dependency audit, secret scan, decision tests, replay/idempotency assertions and privacy checks. A failed gate remains failed.</p><a class="secondary" href="/security">Open security evidence →</a></div></section>
</main>`,
  );
}

function paymentPage(origin: string): string {
  return shell(
    origin,
    "XGuard Payment Decision",
    `<main class="page"><div class="eyebrow">PAYMENT DECISION</div><h1>A free offer. <span>A paid result only when XGuard completes the job.</span></h1><p class="lead narrow">The economic boundary is deliberately simple: showing XGuard does not charge; declining XGuard does not charge; an XGuard service failure does not charge. A fee becomes earned only after the requested decision and durable evidence record are completed.</p>
<div class="flow"><div><b>1</b><span>Payment intent detected</span><small>Free</small></div><div><b>2</b><span>XGuard offered</span><small>Free</small></div><div><b>3</b><span>Buyer / agent opts in</span><small>Fee authorized</small></div><div><b>4</b><span>Checks + evidence complete</span><small>Fee earned</small></div><div><b>5</b><span>Pay or cancel</span><small>No second fee</small></div></div>
<div class="api"><h2>Machine surfaces</h2><code>POST ${origin}/v1/payment/offer</code><code>POST ${origin}/v1/payment/decision</code><code>GET ${origin}/v1/payment/records/{decisionId}</code><code>POST ${origin}/v1/payment/records/{decisionId}/settlement</code><code>POST ${origin}/mcp</code></div>
<div class="notice"><b>Privacy boundary</b><p>XGuard's payment-decision API rejects fields that look like raw card numbers, PAN, CVV/CVC, PIN, private keys, seed phrases or mnemonics. The buyer surface should send declared transaction facts, never payment credentials.</p></div>
</main>`,
  );
}

function securityPage(origin: string): string {
  return shell(
    origin,
    "XGuard Security Evidence",
    `<main class="page"><div class="eyebrow">MEASURABLE SECURITY</div><h1>Evidence, <span>not adjectives.</span></h1><p class="lead narrow">XGuard does not publish “100% secure” claims. Payment Decision changes are gated by machine-verifiable checks bound to source commits. The evidence workflow produces artifacts that can be inspected independently.</p>
<div class="evidence-grid"><article><span>STATIC</span><h2>Type safety + lint</h2><p>TypeScript and ESLint must complete without errors.</p></article><article><span>SUPPLY CHAIN</span><h2>Dependency audit</h2><p>High-severity npm audit findings fail the evidence gate.</p></article><article><span>SECRETS</span><h2>Repository scan</h2><p>The project secret scanner must pass on the same commit.</p></article><article><span>ECONOMIC</span><h2>Fee invariants</h2><p>Offer/skip are non-billable; request IDs are idempotent; a completed decision is charged once.</p></article><article><span>INPUT</span><h2>Credential rejection</h2><p>Raw card/PAN/CVV/private-key shaped fields are rejected by the decision boundary.</p></article><article><span>PRIVACY</span><h2>Buyer surface</h2><p>The browser client does not transmit checkout context until the user chooses XGuard.</p></article></div>
<div class="actions"><a class="primary" href="${origin}/.well-known/xguard-security-evidence.json">Machine-readable policy</a><a class="secondary" href="https://github.com/moelayyan90/XGuard/actions/workflows/payment-security-evidence.yml">CI evidence</a></div></main>`,
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
  return `:root{color-scheme:light;--bg:#f5f8f8;--surface:#fff;--surface-soft:#eef3f3;--ink:#182126;--muted:#68777d;--subtle:#8b989d;--line:#dce4e6;--line-strong:#cbd5d8;--teal:#58aeb8;--teal-dark:#407f87;--teal-soft:#e3f4f5;--silver:#b9c0c4;--shadow:0 24px 70px rgba(52,73,79,.09)}*{box-sizing:border-box}html{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:var(--bg);color:var(--ink);scroll-behavior:smooth}body{margin:0;background:linear-gradient(180deg,#fbfdfd 0,#f5f8f8 520px,#fff 1000px)}a{color:inherit;text-decoration:none}header,footer{max-width:1180px;margin:auto;padding:20px 28px;display:flex;align-items:center;justify-content:space-between}header{position:sticky;top:0;z-index:20;max-width:none;padding-left:max(28px,calc((100vw - 1180px)/2 + 28px));padding-right:max(28px,calc((100vw - 1180px)/2 + 28px));border-bottom:1px solid rgba(220,228,230,.9);background:rgba(251,253,253,.9);backdrop-filter:blur(16px)}footer{border-top:1px solid var(--line);color:var(--muted);font-size:13px;margin-top:80px}footer div{display:flex;gap:18px;align-items:center}.brand{display:flex;align-items:center;gap:10px;letter-spacing:.13em}.brand img{display:block}.brand b{font-size:14px}.footer-brand b{font-size:12px}nav{display:flex;gap:24px;color:#5f6e74;font-size:13px;font-weight:650}nav a:hover,footer a:hover{color:var(--teal-dark)}.hero-wrap{border-bottom:1px solid var(--line);background:radial-gradient(circle at 82% 28%,rgba(88,174,184,.12),transparent 27%),linear-gradient(180deg,#fbfdfd,#f4f8f8)}.hero,.page,.demo,.grid,.band,.proof{max-width:1180px;margin:auto;padding-left:28px;padding-right:28px}.hero{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(260px,.65fr);gap:74px;align-items:center;padding-top:92px;padding-bottom:82px}.hero-copy{min-width:0}.hero-mark{min-height:390px;border:1px solid var(--line);border-radius:22px;background:rgba(255,255,255,.74);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;box-shadow:var(--shadow);overflow:hidden}.hero-mark img{width:min(86%,360px);height:auto}.hero-mark small{font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--subtle);letter-spacing:.16em}.eyebrow{font:700 11px/1.2 ui-monospace,SFMono-Regular,Menlo,monospace;color:var(--teal-dark);letter-spacing:.14em;margin-bottom:22px}h1{font-size:clamp(50px,6.8vw,88px);line-height:.95;letter-spacing:-.055em;margin:0;max-width:920px;font-weight:720}h1 span{color:#8d989d}.lead{font-size:19px;line-height:1.65;max-width:790px;color:var(--muted);margin:30px 0}.narrow{max-width:760px}.actions{display:flex;gap:12px;align-items:center;margin-top:34px}.primary,.secondary{display:inline-flex;padding:12px 17px;border-radius:9px;font-weight:720;font-size:13px;transition:.18s ease}.primary{background:var(--ink);color:#fff;border:1px solid var(--ink)}.primary:hover{background:#2a3b42}.secondary{border:1px solid var(--line-strong);background:#fff}.secondary:hover{border-color:#a9c8cd;color:var(--teal-dark)}.truth{display:flex;gap:24px;flex-wrap:wrap;margin-top:40px;color:var(--muted);font:650 11px ui-monospace,monospace}.truth span{position:relative;padding-left:14px}.truth span:before{content:"";position:absolute;left:0;top:.55em;width:5px;height:5px;border-radius:50%;background:var(--teal)}.demo{display:grid;grid-template-columns:1fr 1fr;gap:0;border:1px solid var(--line);border-radius:18px;overflow:hidden;background:#f8fbfb;padding:0;margin-top:76px;box-shadow:var(--shadow)}.checkout{padding:42px;border-right:1px solid var(--line);min-height:390px;background:#fbfdfd}.checkout small,.guard-card small{color:var(--subtle);font:650 10px ui-monospace,monospace;letter-spacing:.11em}.merchant{font-size:27px;margin-top:44px}.amount{font-size:62px;letter-spacing:-.05em;font-weight:700;margin:12px 0 50px}.amount span{font-size:13px;color:var(--muted);letter-spacing:0}.line{border-top:1px solid var(--line);padding:13px 0;display:flex;justify-content:space-between;color:var(--muted);font-size:13px}.line b{color:var(--ink)}.guard-card{margin:32px;padding:28px;background:#fff;color:var(--ink);border:1px solid var(--line);border-radius:14px;align-self:center;box-shadow:0 18px 50px rgba(55,82,88,.1)}.guard-top{display:flex;align-items:center;gap:12px}.guard-top div{display:flex;flex-direction:column}.guard-top span{color:var(--muted);font-size:12px;margin-top:3px}.guard-card p{color:var(--muted);line-height:1.55}.guard-card button{width:100%;border:0;border-radius:8px;background:var(--teal-dark);color:#fff;padding:12px;font-weight:750;margin:5px 0 12px}.guard-card>a{display:block;text-align:center;color:#66757a;font-size:13px;margin:5px}.guard-card>small{display:block;text-align:center;margin-top:20px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:72px;padding:0}.grid article,.evidence-grid article{background:#fff;padding:34px}.grid i{font-style:normal;color:var(--teal-dark);font:700 11px ui-monospace,monospace}.grid h2,.evidence-grid h2{font-size:22px;margin:34px 0 10px;letter-spacing:-.02em}.grid p,.band p,.proof p,.evidence-grid p,.notice p{color:var(--muted);line-height:1.65}.band,.proof{margin-top:72px;padding-top:52px;padding-bottom:52px;border-top:1px solid var(--line);display:grid;grid-template-columns:1fr 1fr;gap:70px}.band h2,.proof h2{font-size:38px;letter-spacing:-.04em;margin:0}.proof>div:last-child{display:flex;flex-direction:column;align-items:flex-start}.page{padding-top:90px}.page h1{font-size:clamp(46px,5.8vw,76px)}.flow{margin-top:55px;border-top:1px solid var(--line)}.flow div{display:grid;grid-template-columns:50px 1fr auto;gap:16px;padding:20px 0;border-bottom:1px solid var(--line);align-items:center}.flow b{color:var(--teal-dark);font:700 11px ui-monospace,monospace}.flow small{color:var(--muted)}.api,.notice{margin-top:50px;padding:28px;border:1px solid var(--line);border-radius:14px;background:#fff;box-shadow:0 12px 34px rgba(55,82,88,.05)}.api h2{margin-top:0}.api code{display:block;padding:12px 0;border-top:1px solid var(--line);color:#53656b;overflow:auto}.evidence-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);border-radius:16px;overflow:hidden;margin-top:60px}.evidence-grid article span{font:700 10px ui-monospace,monospace;color:var(--teal-dark)}.evidence-grid h2{margin-top:25px}@media(max-width:900px){.hero{grid-template-columns:1fr;gap:42px}.hero-mark{min-height:280px}.hero-mark img{width:min(72%,320px)}}@media(max-width:780px){header{align-items:flex-start}nav{display:none}.hero{padding-top:66px;padding-bottom:60px}.lead{font-size:17px}.truth{flex-direction:column;gap:8px}.demo{grid-template-columns:1fr;margin-top:54px}.checkout{border-right:0;border-bottom:1px solid var(--line)}.grid,.evidence-grid{grid-template-columns:1fr}.band,.proof{grid-template-columns:1fr;gap:18px}.flow div{grid-template-columns:35px 1fr}.flow small{grid-column:2}.actions{flex-wrap:wrap}footer{align-items:flex-start;gap:20px;flex-direction:column}footer div:last-child{align-items:flex-start}.hero-mark{min-height:230px}.hero-mark img{width:min(78%,280px)}}`;
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
