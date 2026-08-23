const GITHUB = "https://github.com/moelayyan90/XGuard";
const BAM = "https://bam.dev/";
const ACE_DISCUSSION = "https://forum.bam.dev/t/brainstorming-paths-to-ace-on-bam/28";

const SPEC = Object.freeze({
  name: "XGuard ACE",
  status: "bam-early-access-candidate",
  purpose: "Deterministic stale-quote protection for opt-in Solana applications on BAM",
  primitive: "application-speed-bump",
  policy: {
    default: "normal-path",
    enrolled_program: "delay-unless-explicit-top-level-bypass-marker",
    cpi_or_indirect_reference: "delay",
    composition: "maximum-delay-wins",
    delay_range_ms: [10, 50]
  },
  critical_path_ai: false,
  telemetry_collection: false,
  repository: GITHUB,
  bam: BAM,
  design_basis: ACE_DISCUSSION
});

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=60",
      "x-content-type-options": "nosniff"
    }
  });
}

function html() {
  return new Response(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="theme-color" content="#f4f3ee">
<title>XGuard ACE — Deterministic Execution Policy for BAM</title>
<meta name="description" content="XGuard ACE is a deterministic application speed-bump policy engine for BAM on Solana.">
<style>
:root{
  color-scheme:light;
  --paper:#f4f3ee;
  --ink:#101010;
  --muted:#66645f;
  --line:#c8c5bd;
  --soft:#e9e7df;
  --blue:#1757ff;
  --max:1240px;
  --pad:clamp(20px,4vw,48px);
  --sans:Arial,Helvetica,sans-serif;
  --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
}
*{box-sizing:border-box}
html{background:var(--paper);scroll-behavior:smooth}
body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.45 var(--sans)}
a{color:inherit}
::selection{background:var(--blue);color:#fff}
.wrap{width:min(calc(100% - var(--pad)*2),var(--max));margin:0 auto}
.mono{font-family:var(--mono)}
header{border-bottom:1px solid var(--ink)}
.nav{min-height:68px;display:grid;grid-template-columns:1fr auto auto;align-items:center;gap:28px}
.brand{font-size:17px;font-weight:800;letter-spacing:-.02em;text-decoration:none}
.brand span{font-weight:400;color:var(--muted);margin-left:8px}
nav{display:flex;gap:24px;font:12px/1 var(--mono);text-transform:uppercase;letter-spacing:.04em}
nav a{text-decoration:none}
nav a:hover{text-decoration:underline;text-underline-offset:4px}
.status{justify-self:end;font:11px/1 var(--mono);text-transform:uppercase;display:flex;align-items:center;gap:8px}
.status i{display:block;width:8px;height:8px;background:var(--blue)}
.hero{display:grid;grid-template-columns:minmax(0,1.7fr) minmax(320px,.8fr);border-bottom:1px solid var(--ink)}
.hero-main{padding:clamp(70px,10vw,138px) 0 clamp(64px,8vw,104px);padding-right:clamp(28px,6vw,86px)}
.kicker{font:12px/1.3 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--blue);margin-bottom:26px}
h1{font-size:clamp(54px,7.2vw,102px);line-height:.92;letter-spacing:-.065em;margin:0;max-width:920px;font-weight:760}
.hero-main p{font-size:clamp(19px,1.8vw,25px);line-height:1.35;max-width:760px;color:#393834;margin:34px 0 0}
.hero-main p strong{color:var(--ink)}
.actions{display:flex;gap:10px;flex-wrap:wrap;margin-top:34px}
.btn{display:inline-block;border:1px solid var(--ink);padding:12px 15px;text-decoration:none;font:12px/1 var(--mono);text-transform:uppercase;letter-spacing:.03em}
.btn.primary{background:var(--ink);color:var(--paper)}
.btn:hover{background:var(--blue);border-color:var(--blue);color:white}
.hero-side{border-left:1px solid var(--ink);padding:32px 30px;display:flex;flex-direction:column;justify-content:space-between}
.side-label{font:11px/1 var(--mono);text-transform:uppercase;color:var(--muted);letter-spacing:.06em}
.contract{margin-top:52px;border-top:1px solid var(--ink)}
.contract-row{display:grid;grid-template-columns:1fr auto;gap:24px;padding:14px 0;border-bottom:1px solid var(--line);font:12px/1.35 var(--mono)}
.contract-row span:last-child{text-align:right}
.contract-row .blue{color:var(--blue)}
.side-foot{margin-top:54px;font:11px/1.45 var(--mono);color:var(--muted)}
.band{border-bottom:1px solid var(--ink);background:var(--ink);color:var(--paper)}
.band-inner{display:grid;grid-template-columns:1.5fr .5fr;align-items:end;min-height:260px;padding:38px 0}
.big-number{font:700 clamp(82px,12vw,176px)/.78 var(--mono);letter-spacing:-.09em}
.big-number small{font-size:.18em;letter-spacing:.02em;margin-left:10px;color:#a9a9a9}
.band-note{font:13px/1.55 var(--mono);color:#bdbdbd;padding-bottom:7px}
.section{border-bottom:1px solid var(--ink)}
.section-grid{display:grid;grid-template-columns:220px 1fr}
.section-label{padding:30px 24px 30px 0;border-right:1px solid var(--ink);font:11px/1.4 var(--mono);text-transform:uppercase;color:var(--muted);letter-spacing:.06em}
.section-body{padding:clamp(44px,6vw,82px) 0 clamp(56px,7vw,96px) clamp(28px,5vw,70px)}
.section-body h2{font-size:clamp(38px,5vw,70px);line-height:.98;letter-spacing:-.055em;margin:0 0 28px;font-weight:740;max-width:900px}
.section-body>p{font-size:19px;line-height:1.5;color:#3e3d39;max-width:800px;margin:0}
.flow{margin-top:54px;border-top:1px solid var(--ink)}
.flow-row{display:grid;grid-template-columns:110px minmax(0,1fr) 190px;align-items:center;min-height:104px;border-bottom:1px solid var(--line)}
.flow-row:last-child{border-bottom:0}
.flow-n{font:11px/1 var(--mono);color:var(--blue)}
.flow-main b{display:block;font-size:20px;margin-bottom:4px;letter-spacing:-.02em}
.flow-main span{color:var(--muted)}
.flow-state{text-align:right;font:11px/1.35 var(--mono);text-transform:uppercase}
.flow-state.protected{color:var(--blue)}
.matrix{margin-top:52px;border-top:1px solid var(--ink)}
.mrow{display:grid;grid-template-columns:1.25fr 1fr .7fr;min-height:72px;border-bottom:1px solid var(--line);align-items:center}
.mrow>div{padding:16px 18px 16px 0}
.mrow.head{font:10px/1 var(--mono);text-transform:uppercase;color:var(--muted);letter-spacing:.07em;min-height:48px}
.mrow .mono{font-size:12px}
.mrow .result{color:var(--blue)}
.quote{margin-top:52px;padding-top:22px;border-top:1px solid var(--ink);font-size:clamp(28px,3.2vw,46px);line-height:1.08;letter-spacing:-.035em;max-width:900px}
.two-col{display:grid;grid-template-columns:1fr 1fr;margin-top:54px;border-top:1px solid var(--ink)}
.principle{padding:30px 34px 36px 0;border-bottom:1px solid var(--line)}
.principle:nth-child(odd){border-right:1px solid var(--ink);padding-right:40px}
.principle:nth-child(even){padding-left:40px}
.principle b{display:block;font-size:22px;margin:10px 0 9px;letter-spacing:-.025em}
.principle p{margin:0;color:var(--muted);max-width:520px}
.principle .n{font:11px/1 var(--mono);color:var(--blue)}
.review{display:grid;grid-template-columns:1.3fr .7fr}
.review-main{padding-right:54px}
.review-side{border-left:1px solid var(--ink);padding-left:32px}
.review-side dl{margin:0}
.review-side div{padding:14px 0;border-bottom:1px solid var(--line)}
.review-side dt{font:10px/1 var(--mono);text-transform:uppercase;color:var(--muted);margin-bottom:7px}
.review-side dd{margin:0;font:12px/1.4 var(--mono)}
footer{padding:28px 0 40px}
.footer{display:flex;justify-content:space-between;gap:24px;font:11px/1.4 var(--mono);color:var(--muted)}
@media(max-width:900px){
  .nav{grid-template-columns:1fr auto}.status{display:none}nav{justify-self:end}
  .hero{grid-template-columns:1fr}.hero-side{border-left:0;border-top:1px solid var(--ink)}
  .band-inner{grid-template-columns:1fr}.band-note{margin-top:24px}
  .section-grid{grid-template-columns:1fr}.section-label{border-right:0;border-bottom:1px solid var(--ink);padding-right:0}.section-body{padding-left:0}
  .review{grid-template-columns:1fr}.review-main{padding-right:0}.review-side{border-left:0;border-top:1px solid var(--ink);padding:30px 0 0;margin-top:40px}
}
@media(max-width:640px){
  nav{display:none}.nav{grid-template-columns:1fr}
  h1{font-size:clamp(50px,16vw,78px)}
  .hero-main{padding-top:62px}
  .flow-row{grid-template-columns:52px 1fr}.flow-state{grid-column:2;text-align:left;padding:0 0 18px}
  .mrow{grid-template-columns:1fr}.mrow.head{display:none}.mrow>div{padding:10px 0}.mrow{padding:12px 0}
  .two-col{grid-template-columns:1fr}.principle:nth-child(odd){border-right:0;padding-right:0}.principle:nth-child(even){padding-left:0}
  .footer{flex-direction:column}
}
</style>
</head>
<body>
<header>
  <div class="wrap nav">
    <a class="brand" href="/">XGuard <span>ACE</span></a>
    <nav>
      <a href="#mechanism">Mechanism</a>
      <a href="#policy">Policy</a>
      <a href="/spec.json">Spec</a>
      <a href="${GITHUB}">GitHub</a>
    </nav>
    <div class="status"><i></i>BAM early-access candidate</div>
  </div>
</header>
<main>
  <section class="wrap hero">
    <div class="hero-main">
      <div class="kicker">Deterministic execution policy for BAM</div>
      <h1>Order before execution.</h1>
      <p><strong>Protect market makers from stale-quote flow.</strong> XGuard ACE applies a bounded application-level delay to protected transactions while explicitly marked critical instructions remain on the normal path.</p>
      <div class="actions">
        <a class="btn primary" href="${GITHUB}">Review implementation</a>
        <a class="btn" href="${ACE_DISCUSSION}">BAM design basis</a>
      </div>
    </div>
    <aside class="hero-side">
      <div>
        <div class="side-label">Execution contract</div>
        <div class="contract">
          <div class="contract-row"><span>Unknown program</span><span>Normal path</span></div>
          <div class="contract-row"><span>Protected top-level call</span><span class="blue">Delay</span></div>
          <div class="contract-row"><span>Explicit bypass marker</span><span>Normal path</span></div>
          <div class="contract-row"><span>Indirect / CPI reference</span><span class="blue">Delay</span></div>
          <div class="contract-row"><span>Composition</span><span>Max delay wins</span></div>
        </div>
      </div>
      <div class="side-foot">Pure Rust policy engine. No LLM, network request, database lookup, custody, signing, or transaction mutation in the critical path.</div>
    </aside>
  </section>

  <section class="band">
    <div class="wrap band-inner">
      <div class="big-number">10–50<small>ms</small></div>
      <div class="band-note">Bounded application speed-bump range described by BAM's public ACE design direction. XGuard never expands the configured delay beyond this policy boundary.</div>
    </div>
  </section>

  <section class="section" id="mechanism">
    <div class="wrap section-grid">
      <div class="section-label">01 / Mechanism</div>
      <div class="section-body">
        <h2>A small rule in the only place that matters.</h2>
        <p>XGuard sits at the routing boundary before scheduler admission. It does not ask traders, wallets, or market makers to install anything. An enrolled application's policy is evaluated deterministically before the transaction continues.</p>
        <div class="flow">
          <div class="flow-row"><div class="flow-n">01</div><div class="flow-main"><b>Transaction enters BAM</b><span>Top-level instructions and referenced program keys are available to the routing layer.</span></div><div class="flow-state">input</div></div>
          <div class="flow-row"><div class="flow-n">02</div><div class="flow-main"><b>XGuard evaluates policy</b><span>Program id, instruction marker, indirect references, and composition are checked.</span></div><div class="flow-state protected">deterministic</div></div>
          <div class="flow-row"><div class="flow-n">03</div><div class="flow-main"><b>One scheduling decision</b><span>Normal path or bounded delay. Nothing else is modified.</span></div><div class="flow-state">0 / 10–50 ms</div></div>
          <div class="flow-row"><div class="flow-n">04</div><div class="flow-main"><b>BAM scheduler continues</b><span>The application-specific guarantee is applied before normal execution proceeds.</span></div><div class="flow-state">output</div></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section" id="policy">
    <div class="wrap section-grid">
      <div class="section-label">02 / Policy</div>
      <div class="section-body">
        <h2>Protected by default. Bypass only when explicit.</h2>
        <p>The rule is intentionally conservative: registered applications define exact top-level bypass markers. Everything else that matches the protected application is delayed.</p>
        <div class="matrix">
          <div class="mrow head"><div>Observed transaction state</div><div>Decision</div><div>Delay</div></div>
          <div class="mrow"><div>Unregistered program</div><div class="mono">normal_path</div><div class="mono">0 ms</div></div>
          <div class="mrow"><div>Registered + bypass marker</div><div class="mono">normal_path</div><div class="mono">0 ms</div></div>
          <div class="mrow"><div>Registered + no bypass marker</div><div class="mono result">protected</div><div class="mono result">10–50 ms</div></div>
          <div class="mrow"><div>Indirect / CPI-style reference</div><div class="mono result">protected</div><div class="mono result">10–50 ms</div></div>
          <div class="mrow"><div>Multiple registered programs</div><div class="mono result">max_rule</div><div class="mono result">max match</div></div>
        </div>
        <div class="quote">The goal is not to predict a bad trade. The goal is to make stale-quote protection a deterministic scheduling property.</div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-grid">
      <div class="section-label">03 / System design</div>
      <div class="section-body">
        <h2>No intelligence theater in the critical path.</h2>
        <p>The implementation is deliberately narrow because execution guarantees are easier to review when the same inputs always produce the same output.</p>
        <div class="two-col">
          <div class="principle"><div class="n">A</div><b>Deterministic</b><p>No probabilistic classifier, model inference, or remote dependency during classification.</p></div>
          <div class="principle"><div class="n">B</div><b>Application-scoped</b><p>Programs that do not opt in remain on BAM's normal scheduling path.</p></div>
          <div class="principle"><div class="n">C</div><b>Composable</b><p>When several enrolled programs match one transaction, the maximum configured delay wins.</p></div>
          <div class="principle"><div class="n">D</div><b>Reviewable</b><p>The core engine is pure Rust with bounded configuration size and fixture-driven tests.</p></div>
        </div>
      </div>
    </div>
  </section>

  <section class="section">
    <div class="wrap section-grid">
      <div class="section-label">04 / Review status</div>
      <div class="section-body review">
        <div class="review-main">
          <h2>Built. Tested. Waiting on the official BAM integration boundary.</h2>
          <p>The policy engine, simulator, security model, benchmark plan, public specification, CI, CodeQL, and Cloudflare review surface are implemented. Production activation still depends on BAM early-access approval and the supported ACE/plugin interface.</p>
          <div class="actions">
            <a class="btn primary" href="${GITHUB}">Open repository</a>
            <a class="btn" href="/spec.json">Machine spec</a>
            <a class="btn" href="${BAM}">BAM</a>
          </div>
        </div>
        <aside class="review-side">
          <dl>
            <div><dt>Core language</dt><dd>Rust</dd></div>
            <div><dt>Critical-path AI</dt><dd>None</dd></div>
            <div><dt>Delay bound</dt><dd>10–50 ms</dd></div>
            <div><dt>Unknown programs</dt><dd>Unaffected</dd></div>
            <div><dt>Public status</dt><dd>Early-access candidate</dd></div>
          </dl>
        </aside>
      </div>
    </div>
  </section>
</main>
<footer>
  <div class="wrap footer"><span>XGuard ACE / Apache-2.0</span><span>Deterministic application scheduling policy for BAM</span></div>
</footer>
</body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=120",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY"
    }
  });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") {
      return json({ error: "method_not_allowed" }, 405);
    }
    if (url.pathname === "/healthz") {
      return json({ status: "ok", service: "XGuard ACE", mode: "bam-early-access-candidate" });
    }
    if (url.pathname === "/spec.json") return json(SPEC);
    if (url.pathname === "/robots.txt") {
      return new Response("User-agent: *\nAllow: /\n", { headers: { "content-type": "text/plain; charset=utf-8" } });
    }
    if (url.pathname === "/.well-known/security.txt") {
      return new Response(`Contact: mailto:mo.elayyan2023@gmail.com\nCanonical: https://xguardgate.com/.well-known/security.txt\n`, {
        headers: { "content-type": "text/plain; charset=utf-8" }
      });
    }
    if (url.pathname === "/" || url.pathname === "/index.html") return html();
    return json({ error: "not_found" }, 404);
  }
};
