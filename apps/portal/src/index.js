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
<meta name="theme-color" content="#0a0a09">
<title>XGuard ACE — Stale-Quote Protection for BAM</title>
<meta name="description" content="XGuard ACE is a deterministic application-speed-bump policy engine for BAM on Solana, designed to reduce stale-quote exposure without putting AI in the critical path.">
<style>
:root{
  color-scheme:dark;
  --bg:#0a0a09;
  --bg-soft:#10100f;
  --ink:#f2efe8;
  --muted:#9a968f;
  --faint:#5f5c56;
  --line:#292824;
  --line-hot:#4e251c;
  --signal:#ff5a36;
  --signal-soft:#a83a24;
  --ok:#b9c7a2;
  --max:1320px;
  --pad:clamp(20px,4vw,56px);
  --mono:ui-monospace,SFMono-Regular,Menlo,Monaco,Consolas,"Liberation Mono",monospace;
  --sans:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font-family:var(--sans);font-size:16px;line-height:1.5;overflow-x:hidden}
body:before{content:"";position:fixed;inset:0;pointer-events:none;z-index:-2;background-image:linear-gradient(to right,rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(to bottom,rgba(255,255,255,.022) 1px,transparent 1px);background-size:80px 80px;background-position:center top}
body:after{content:"";position:fixed;inset:0;pointer-events:none;z-index:-1;background:radial-gradient(circle at 78% 12%,rgba(255,90,54,.08),transparent 29rem)}
a{color:inherit}
::selection{background:var(--signal);color:#090909}
.shell{width:min(calc(100% - (var(--pad) * 2)),var(--max));margin-inline:auto}
.mono{font-family:var(--mono)}
.eyebrow{font:700 11px/1.2 var(--mono);letter-spacing:.16em;text-transform:uppercase;color:var(--muted)}
.topbar{border-bottom:1px solid var(--line);background:rgba(10,10,9,.84);backdrop-filter:blur(16px);position:sticky;top:0;z-index:30}
.nav{height:74px;display:grid;grid-template-columns:1fr auto 1fr;align-items:center;gap:20px}
.brand{display:inline-flex;align-items:center;gap:12px;text-decoration:none;width:max-content;font-weight:800;letter-spacing:-.02em}
.mark{width:28px;height:28px;border:1px solid #5a5750;position:relative;display:grid;place-items:center}
.mark:before,.mark:after{content:"";position:absolute;width:15px;height:1px;background:var(--signal);transform-origin:center}.mark:before{transform:rotate(45deg)}.mark:after{transform:rotate(-45deg)}
.nav-center{display:flex;gap:26px;font:600 12px/1 var(--mono);letter-spacing:.05em;text-transform:uppercase;color:#b9b5ae}
.nav-center a{text-decoration:none}.nav-center a:hover{color:var(--ink)}
.nav-right{justify-self:end;display:flex;align-items:center;gap:10px;font:600 11px/1 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.08em}
.dot{width:7px;height:7px;background:var(--signal);box-shadow:0 0 0 4px rgba(255,90,54,.08)}
.hero{min-height:calc(100svh - 74px);display:grid;grid-template-columns:minmax(0,7fr) minmax(340px,5fr);border-left:1px solid var(--line);border-right:1px solid var(--line)}
.hero-copy{padding:clamp(72px,10vw,142px) clamp(24px,5vw,72px) 72px;display:flex;flex-direction:column;justify-content:space-between;min-height:760px}
.hero-copy h1{font-size:clamp(58px,7.3vw,118px);line-height:.88;letter-spacing:-.07em;font-weight:750;margin:26px 0 30px;max-width:900px}
.hero-copy h1 em{font-style:normal;color:var(--signal)}
.lead{font-size:clamp(18px,1.7vw,25px);line-height:1.42;color:#b9b5ae;max-width:760px;margin:0}
.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:36px}
.button{display:inline-flex;align-items:center;gap:12px;text-decoration:none;border:1px solid #46433d;padding:13px 16px;font:700 12px/1 var(--mono);text-transform:uppercase;letter-spacing:.04em;transition:background .18s ease,border-color .18s ease,color .18s ease}
.button.primary{background:var(--ink);color:#10100f;border-color:var(--ink)}
.button.primary:hover{background:var(--signal);border-color:var(--signal)}
.button.ghost:hover{border-color:var(--ink)}
.hero-note{padding-top:60px;display:flex;gap:28px;align-items:flex-end;color:var(--faint);font:12px/1.45 var(--mono);max-width:690px}
.hero-note strong{color:#aaa69f;font-weight:500}
.execution{border-left:1px solid var(--line);display:flex;flex-direction:column;min-height:760px;background:rgba(16,16,15,.52)}
.execution-head{padding:24px 28px;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;align-items:center;font:700 11px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em;color:var(--muted)}
.execution-screen{flex:1;display:flex;flex-direction:column;justify-content:center;padding:clamp(28px,4vw,48px);position:relative;overflow:hidden}
.execution-screen:before{content:"";position:absolute;left:0;right:0;top:47%;height:1px;background:#383631}
.screen-label{position:absolute;top:32px;left:clamp(28px,4vw,48px);font:600 11px/1.3 var(--mono);color:var(--faint);letter-spacing:.06em;text-transform:uppercase}
.window-number{font:500 clamp(82px,9vw,150px)/.8 var(--mono);letter-spacing:-.08em;color:var(--ink)}
.window-number span{font-size:.24em;letter-spacing:0;color:var(--muted);margin-left:10px}
.window-caption{font:13px/1.6 var(--mono);color:var(--muted);max-width:400px;margin:28px 0 58px}
.timeline{position:relative;height:118px;border-top:1px solid #47443e;border-bottom:1px solid #24231f}
.tick{position:absolute;top:-6px;width:1px;height:12px;background:#777269}.tick:after{position:absolute;top:20px;transform:translateX(-50%);font:10px/1 var(--mono);color:#706c65}.t0{left:0}.t0:after{content:"0"}.t10{left:20%}.t10:after{content:"10"}.t20{left:40%}.t20:after{content:"20"}.t30{left:60%}.t30:after{content:"30"}.t40{left:80%}.t40:after{content:"40"}.t50{left:100%}.t50:after{content:"50"}
.delay-band{position:absolute;left:20%;right:0;top:54px;height:16px;background:repeating-linear-gradient(90deg,var(--signal) 0 8px,transparent 8px 12px);opacity:.88}
.normal-band{position:absolute;left:0;width:20%;top:54px;height:16px;background:#68645c}
.sweep{position:absolute;top:-1px;bottom:-1px;width:1px;background:#fff;left:0;box-shadow:0 0 18px rgba(255,255,255,.45);animation:sweep 4.2s cubic-bezier(.6,0,.2,1) infinite}
@keyframes sweep{0%{left:0;opacity:0}8%{opacity:1}82%{left:100%;opacity:1}100%{left:100%;opacity:0}}
.legend{margin-top:26px;display:grid;grid-template-columns:1fr 1fr;gap:14px;font:11px/1.5 var(--mono);color:var(--muted)}
.legend span{display:flex;align-items:center;gap:9px}.legend i{width:16px;height:2px;background:#68645c}.legend .hot i{background:var(--signal)}
.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-top:0}
.metric{padding:26px clamp(18px,3vw,32px);border-right:1px solid var(--line)}.metric:last-child{border-right:0}
.metric b{display:block;font:500 clamp(27px,3.4vw,46px)/1 var(--mono);letter-spacing:-.05em;margin-bottom:12px}.metric small{display:block;color:var(--muted);font:11px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.07em}
.section{border-left:1px solid var(--line);border-right:1px solid var(--line);border-bottom:1px solid var(--line)}
.section-head{display:grid;grid-template-columns:1fr 2fr;border-bottom:1px solid var(--line)}
.section-index{padding:34px 28px;border-right:1px solid var(--line);font:12px/1 var(--mono);color:var(--signal)}
.section-title{padding:32px clamp(28px,5vw,64px)}
.section-title h2{font-size:clamp(36px,5vw,68px);line-height:.98;letter-spacing:-.055em;margin:0;font-weight:700;max-width:900px}
.section-title p{color:var(--muted);max-width:760px;margin:22px 0 0;font-size:18px}
.architecture{display:grid;grid-template-columns:1.05fr 2fr}
.arch-notes{padding:48px 28px;border-right:1px solid var(--line);font:12px/1.65 var(--mono);color:var(--muted)}
.arch-notes strong{color:var(--ink);font-weight:500}.arch-steps{padding:0}
.arch-row{display:grid;grid-template-columns:90px 1fr 190px;align-items:center;min-height:130px;border-bottom:1px solid var(--line)}.arch-row:last-child{border-bottom:0}
.arch-num{height:100%;display:grid;place-items:center;border-right:1px solid var(--line);font:13px/1 var(--mono);color:var(--signal)}
.arch-main{padding:28px 34px}.arch-main b{display:block;font-size:22px;letter-spacing:-.025em;margin-bottom:5px}.arch-main span{color:var(--muted)}
.arch-state{padding:0 24px;font:11px/1.5 var(--mono);color:var(--muted);text-transform:uppercase;letter-spacing:.06em}.arch-state .state{display:inline-flex;align-items:center;gap:8px}.arch-state .state:before{content:"";width:6px;height:6px;background:var(--ok)}.arch-state .protected:before{background:var(--signal)}
.policy-wrap{display:grid;grid-template-columns:1.1fr .9fr}
.policy-table{border-right:1px solid var(--line)}
.policy-row{display:grid;grid-template-columns:1.2fr 1fr .75fr;min-height:92px;border-bottom:1px solid var(--line);align-items:center}.policy-row:last-child{border-bottom:0}
.policy-row>div{padding:20px 26px}.policy-row>div:not(:last-child){border-right:1px solid var(--line)}
.policy-row.head{min-height:54px;color:var(--faint);font:10px/1 var(--mono);text-transform:uppercase;letter-spacing:.09em}
.policy-row .event{font-weight:650}.policy-row .route{font:12px/1.4 var(--mono);color:#c5c0b8}.policy-row .delay{font:12px/1 var(--mono);color:var(--signal)}
.code-panel{padding:34px;display:flex;flex-direction:column;justify-content:space-between;background:#0d0d0c}
.code-panel pre{margin:0;white-space:pre-wrap;font:12px/1.75 var(--mono);color:#bbb7af}.code-panel .key{color:#77736c}.code-panel .value{color:#ece8e0}.code-panel .hot{color:var(--signal)}
.code-caption{padding-top:42px;color:var(--faint);font:10px/1.5 var(--mono);text-transform:uppercase;letter-spacing:.07em}
.principles{display:grid;grid-template-columns:repeat(2,1fr)}
.principle{padding:48px clamp(26px,4vw,48px);min-height:300px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}.principle:nth-child(2n){border-right:0}.principle:nth-last-child(-n+2){border-bottom:0}
.principle .num{font:11px/1 var(--mono);color:var(--signal)}.principle h3{font-size:clamp(28px,3vw,42px);line-height:1.02;letter-spacing:-.045em;margin:58px 0 20px}.principle p{color:var(--muted);max-width:520px;margin:0;font-size:17px}
.status-band{display:grid;grid-template-columns:1.4fr .6fr;align-items:stretch}
.status-copy{padding:64px clamp(28px,5vw,64px);border-right:1px solid var(--line)}.status-copy h2{font-size:clamp(36px,5vw,72px);letter-spacing:-.055em;line-height:.95;margin:0 0 26px}.status-copy p{color:var(--muted);max-width:760px;font-size:18px}.status-copy .hero-actions{margin-top:30px}
.status-side{padding:38px 28px;display:flex;flex-direction:column;justify-content:space-between;background:var(--bg-soft)}
.status-side .stamp{font:700 11px/1.45 var(--mono);color:var(--signal);letter-spacing:.08em;text-transform:uppercase}.status-side .fine{font:11px/1.55 var(--mono);color:var(--faint)}
.footer{border-left:1px solid var(--line);border-right:1px solid var(--line);padding:28px;display:flex;justify-content:space-between;gap:30px;color:var(--faint);font:10px/1.4 var(--mono);text-transform:uppercase;letter-spacing:.08em}
@media(max-width:980px){
  .nav{grid-template-columns:1fr auto}.nav-center{display:none}.hero{grid-template-columns:1fr}.hero-copy{min-height:650px}.execution{border-left:0;border-top:1px solid var(--line);min-height:610px}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}.section-head,.architecture,.policy-wrap,.status-band{grid-template-columns:1fr}.section-index,.arch-notes,.policy-table,.status-copy{border-right:0;border-bottom:1px solid var(--line)}.arch-row{grid-template-columns:72px 1fr}.arch-state{grid-column:2;padding:0 34px 24px}.principles{grid-template-columns:1fr}.principle{border-right:0!important;border-bottom:1px solid var(--line)!important}.principle:last-child{border-bottom:0!important}
}
@media(max-width:640px){
  .nav{height:66px}.nav-right{font-size:9px}.hero{border-left:0;border-right:0}.hero-copy{padding:62px 20px 48px;min-height:620px}.hero-copy h1{font-size:clamp(54px,17vw,76px)}.hero-note{display:block}.hero-note span{display:block;margin-top:10px}.execution-screen{padding:28px 20px}.execution-head{padding:20px}.window-number{font-size:88px}.legend{grid-template-columns:1fr}.metrics{border-left:0;border-right:0}.metric{padding:22px 20px}.section{border-left:0;border-right:0}.section-title{padding:28px 20px}.section-index{padding:22px 20px}.arch-notes{padding:30px 20px}.arch-row{grid-template-columns:58px 1fr;min-height:120px}.arch-main{padding:24px 20px}.arch-state{padding:0 20px 22px}.policy-row{grid-template-columns:1.1fr .9fr}.policy-row .delay{grid-column:1/-1;border-top:1px solid var(--line);border-right:0!important}.policy-row.head .delay{display:none}.code-panel{padding:28px 20px}.principle{padding:36px 20px;min-height:260px}.principle h3{margin-top:44px}.status-copy{padding:48px 20px}.status-side{padding:28px 20px}.footer{border-left:0;border-right:0;flex-direction:column;padding:24px 20px}
}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}.sweep{animation:none;left:40%}}
</style>
</head>
<body>
<header class="topbar">
  <div class="shell nav">
    <a class="brand" href="/" aria-label="XGuard ACE home"><span class="mark" aria-hidden="true"></span><span>XGuard ACE</span></a>
    <nav class="nav-center" aria-label="Primary"><a href="#architecture">Architecture</a><a href="#policy">Policy</a><a href="#principles">Principles</a></nav>
    <div class="nav-right"><span class="dot" aria-hidden="true"></span>BAM early-access candidate</div>
  </div>
</header>

<main class="shell">
  <section class="hero" aria-labelledby="hero-title">
    <div class="hero-copy">
      <div>
        <div class="eyebrow">Application Controlled Execution / Solana</div>
        <h1 id="hero-title">A 20ms advantage is still an <em>advantage.</em></h1>
        <p class="lead">Protect market makers from stale-quote flow. XGuard applies a deterministic, application-defined execution delay inside BAM while explicitly marked critical instructions remain on the normal path.</p>
        <div class="hero-actions">
          <a class="button primary" href="${GITHUB}">Inspect the Rust core <span aria-hidden="true">↗</span></a>
          <a class="button ghost" href="${ACE_DISCUSSION}">Read the BAM design basis</a>
        </div>
      </div>
      <div class="hero-note"><strong>No AI in the critical path.</strong><span>No custody. No transaction mutation. No private registration database. The same policy and transaction always produce the same decision.</span></div>
    </div>

    <aside class="execution" aria-label="Policy window visualization">
      <div class="execution-head"><span>Execution window</span><span>reference model / ms</span></div>
      <div class="execution-screen">
        <div class="screen-label">Bounded application delay</div>
        <div class="window-number">10—50<span>ms</span></div>
        <div class="window-caption">Illustrative policy window. XGuard classifies whether enrolled application flow remains on BAM's normal path or enters a bounded delayed pool.</div>
        <div class="timeline" aria-hidden="true">
          <span class="tick t0"></span><span class="tick t10"></span><span class="tick t20"></span><span class="tick t30"></span><span class="tick t40"></span><span class="tick t50"></span>
          <span class="normal-band"></span><span class="delay-band"></span><span class="sweep"></span>
        </div>
        <div class="legend"><span><i></i>normal scheduling path</span><span class="hot"><i></i>application speed-bump range</span></div>
      </div>
    </aside>
  </section>

  <section class="metrics" aria-label="XGuard characteristics">
    <div class="metric"><b>10–50ms</b><small>bounded application delay</small></div>
    <div class="metric"><b>0</b><small>model calls in critical path</small></div>
    <div class="metric"><b>MAX</b><small>delay wins on composition</small></div>
    <div class="metric"><b>RUST</b><small>deterministic policy core</small></div>
  </section>

  <section class="section" id="architecture">
    <div class="section-head">
      <div class="section-index">01 / ARCHITECTURE</div>
      <div class="section-title"><h2>One decision before scheduler admission.</h2><p>XGuard is deliberately narrow. BAM provides the routing environment; XGuard resolves the application policy; the scheduler keeps ownership of execution.</p></div>
    </div>
    <div class="architecture">
      <div class="arch-notes"><strong>Critical-path rule:</strong><br><br>Read only the transaction view required for policy classification. Do not call an RPC, database, LLM, remote API, or wall clock. Keep unrelated applications untouched.</div>
      <div class="arch-steps">
        <div class="arch-row"><div class="arch-num">01</div><div class="arch-main"><b>Transaction arrives</b><span>BAM router provides the transaction context.</span></div><div class="arch-state"><span class="state">normal ingestion</span></div></div>
        <div class="arch-row"><div class="arch-num">02</div><div class="arch-main"><b>XGuard resolves policy</b><span>Program id, instruction markers, indirect references and composition are evaluated deterministically.</span></div><div class="arch-state"><span class="state protected">policy match</span></div></div>
        <div class="arch-row"><div class="arch-num">03</div><div class="arch-main"><b>Route is selected</b><span>Zero delay stays on the normal path. Protected flow receives the configured bounded delay.</span></div><div class="arch-state"><span class="state">0ms or 10–50ms</span></div></div>
        <div class="arch-row"><div class="arch-num">04</div><div class="arch-main"><b>BAM schedules execution</b><span>XGuard does not sign, mutate, settle or custody the transaction.</span></div><div class="arch-state"><span class="state">scheduler owned</span></div></div>
      </div>
    </div>
  </section>

  <section class="section" id="policy">
    <div class="section-head">
      <div class="section-index">02 / POLICY</div>
      <div class="section-title"><h2>Predictable behavior. No hidden classifier.</h2><p>The policy is intentionally boring enough to audit. Every route comes from explicit application rules and transaction structure.</p></div>
    </div>
    <div class="policy-wrap">
      <div class="policy-table" role="table" aria-label="XGuard policy matrix">
        <div class="policy-row head" role="row"><div>Transaction condition</div><div>Route</div><div>Delay</div></div>
        <div class="policy-row" role="row"><div class="event">Unknown program</div><div class="route">normal_path</div><div class="delay">0ms</div></div>
        <div class="policy-row" role="row"><div class="event">Explicit bypass marker</div><div class="route">normal_path</div><div class="delay">0ms</div></div>
        <div class="policy-row" role="row"><div class="event">Protected top-level call</div><div class="route">delayed_pool</div><div class="delay">10–50ms</div></div>
        <div class="policy-row" role="row"><div class="event">Indirect / CPI reference</div><div class="route">delayed_pool</div><div class="delay">10–50ms</div></div>
        <div class="policy-row" role="row"><div class="event">Multiple enrolled apps</div><div class="route">max_rule</div><div class="delay">MAX</div></div>
      </div>
      <div class="code-panel" aria-label="Reference decision example">
        <pre><span class="key">{</span>
  <span class="key">"program_id"</span>: <span class="value">"…"</span>,
  <span class="key">"reason"</span>: <span class="value">"protected_top_level_instruction"</span>,
  <span class="key">"delay_ms"</span>: <span class="hot">20</span>,
  <span class="key">"critical_path_ai"</span>: <span class="value">false</span>
<span class="key">}</span></pre>
        <div class="code-caption">Reference output / deterministic decision object</div>
      </div>
    </div>
  </section>

  <section class="section" id="principles">
    <div class="section-head">
      <div class="section-index">03 / DESIGN PRINCIPLES</div>
      <div class="section-title"><h2>The hard part is what XGuard refuses to do.</h2></div>
    </div>
    <div class="principles">
      <article class="principle"><div class="num">A / 01</div><h3>Unrelated flow stays unrelated.</h3><p>Applications that never enroll are not delayed, classified or routed differently by XGuard.</p></article>
      <article class="principle"><div class="num">A / 02</div><h3>Bypass must be explicit.</h3><p>Critical maker, oracle, liquidation or health instructions stay fast only through application-defined top-level markers.</p></article>
      <article class="principle"><div class="num">A / 03</div><h3>Composition cannot weaken policy.</h3><p>If one transaction touches several enrolled programs, the longest matching delay wins instead of creating a shorter-path escape hatch.</p></article>
      <article class="principle"><div class="num">A / 04</div><h3>No fake production claims.</h3><p>The Rust core and public review surface are live. Production BAM activation remains dependent on the official ACE integration and early-access path.</p></article>
    </div>
  </section>

  <section class="section status-band">
    <div class="status-copy">
      <div class="eyebrow">Current state</div>
      <h2>Built for BAM review.</h2>
      <p>The repository contains the deterministic policy core, correctness tests, fixture-driven simulator, security model, benchmark plan and the explicit BAM integration boundary.</p>
      <div class="hero-actions"><a class="button primary" href="${GITHUB}">Review repository <span aria-hidden="true">↗</span></a><a class="button ghost" href="/spec.json">Machine-readable spec</a><a class="button ghost" href="${BAM}">BAM</a></div>
    </div>
    <aside class="status-side"><div class="stamp">Status<br>BAM early-access candidate</div><div class="fine">Public web surface only.<br>Cloudflare is not in the Solana transaction critical path.<br><br>Apache-2.0</div></aside>
  </section>
</main>

<footer class="shell footer"><span>XGuard ACE / deterministic stale-quote protection</span><span>Solana · BAM · Application Controlled Execution</span></footer>
</body>
</html>`, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=300",
      "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      "referrer-policy": "no-referrer",
      "x-content-type-options": "nosniff",
      "x-frame-options": "DENY",
      "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=()"
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
