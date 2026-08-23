const GITHUB = "https://github.com/moelayyan90/XGuard";
const BAM = "https://bam.dev/";
const ACE_DISCUSSION = "https://forum.bam.dev/t/brainstorming-paths-to-ace-on-bam/28";
const SITE = "https://xguardgate.com";
const SITE_VERSION = "xguard-site-v4";

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

const CSS = String.raw`
:root{
  color-scheme:dark;
  --bg:#07090d;
  --bg-2:#0b0e14;
  --panel:#0f131b;
  --panel-2:#121722;
  --ink:#f5f7fb;
  --muted:#929bad;
  --muted-2:#687386;
  --line:rgba(255,255,255,.09);
  --line-strong:rgba(255,255,255,.15);
  --accent:#7c8cff;
  --accent-2:#4de2c5;
  --accent-soft:rgba(124,140,255,.13);
  --success:#56e6aa;
  --warning:#ffcf70;
  --max:1200px;
  --pad:clamp(20px,4vw,52px);
  --sans:Inter,ui-sans-serif,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;
  --mono:"SFMono-Regular",Consolas,"Liberation Mono",Menlo,monospace;
  --shadow:0 22px 70px rgba(0,0,0,.32);
}
*{box-sizing:border-box}
html{scroll-behavior:smooth;background:var(--bg)}
body{margin:0;background:var(--bg);color:var(--ink);font:16px/1.55 var(--sans);-webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
a{color:inherit}
img,svg{display:block;max-width:100%}
button,input,textarea{font:inherit}
::selection{background:var(--accent);color:#fff}
.shell{width:min(calc(100% - var(--pad)*2),var(--max));margin-inline:auto}
.eyebrow{display:inline-flex;align-items:center;gap:10px;color:#b9c0cf;font-size:12px;font-weight:700;letter-spacing:.12em;text-transform:uppercase}
.eyebrow:before{content:"";width:7px;height:7px;border-radius:50%;background:var(--accent-2);box-shadow:0 0 0 4px rgba(77,226,197,.08)}
.mono{font-family:var(--mono)}
.muted{color:var(--muted)}
.accent{color:#aeb7ff}

.site-header{position:sticky;top:0;z-index:50;background:rgba(7,9,13,.82);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.065)}
.navbar{height:74px;display:flex;align-items:center;justify-content:space-between;gap:28px}
.brand{display:flex;align-items:center;gap:11px;text-decoration:none;min-width:max-content}
.brand-mark{width:31px;height:31px}
.brand-word{font-weight:770;letter-spacing:-.025em;font-size:17px}.brand-word span{color:var(--muted);font-weight:580;margin-left:5px}
.nav-links{display:flex;align-items:center;gap:28px}
.nav-links a{font-size:14px;color:#bec5d2;text-decoration:none;transition:color .18s ease}
.nav-links a:hover,.nav-links a.active{color:#fff}
.nav-actions{display:flex;align-items:center;gap:10px}
.nav-status{display:flex;align-items:center;gap:8px;color:#98a2b4;font-size:12px;white-space:nowrap}
.nav-status i{width:7px;height:7px;border-radius:50%;background:var(--warning);box-shadow:0 0 0 4px rgba(255,207,112,.08)}
.menu{display:none;position:relative}.menu summary{cursor:pointer;list-style:none;border:1px solid var(--line-strong);width:42px;height:42px;border-radius:11px;display:grid;place-items:center}.menu summary::-webkit-details-marker{display:none}.menu-panel{position:absolute;right:0;top:52px;width:230px;background:#0f131b;border:1px solid var(--line-strong);border-radius:14px;padding:10px;box-shadow:var(--shadow)}.menu-panel a{display:block;padding:11px 12px;text-decoration:none;color:#c7ced9;border-radius:9px}.menu-panel a:hover{background:rgba(255,255,255,.05);color:#fff}

.btn{display:inline-flex;align-items:center;justify-content:center;gap:10px;min-height:46px;padding:0 18px;border-radius:11px;border:1px solid var(--line-strong);text-decoration:none;font-weight:680;font-size:14px;transition:transform .18s ease,background .18s ease,border-color .18s ease}
.btn:hover{transform:translateY(-1px);border-color:rgba(255,255,255,.26)}
.btn.primary{background:#f4f6fa;color:#0a0d12;border-color:#f4f6fa}.btn.primary:hover{background:#fff}
.btn.secondary{background:rgba(255,255,255,.035)}
.btn.ghost{border-color:transparent;color:#b9c2d0;padding-inline:4px;min-height:auto}
.btn svg{width:16px;height:16px}
.section{padding:clamp(80px,9vw,132px) 0;border-top:1px solid var(--line)}
.section.soft{background:linear-gradient(180deg,rgba(255,255,255,.018),rgba(255,255,255,0))}
.section-head{display:grid;grid-template-columns:minmax(0,1fr) minmax(280px,480px);gap:60px;align-items:end;margin-bottom:54px}
.section-head h2{font-size:clamp(38px,5vw,68px);line-height:1;letter-spacing:-.055em;margin:15px 0 0;max-width:800px}.section-head p{margin:0;color:var(--muted);font-size:18px}
.kicker{font-size:12px;font-weight:760;letter-spacing:.12em;text-transform:uppercase;color:#aab3c2}
.rule{height:1px;background:var(--line);margin:32px 0}

.hero{position:relative;overflow:hidden;padding:clamp(86px,10vw,150px) 0 88px;background:
radial-gradient(circle at 78% 22%,rgba(124,140,255,.15),transparent 31%),
radial-gradient(circle at 91% 58%,rgba(77,226,197,.08),transparent 26%),
linear-gradient(180deg,#07090d 0%,#080b10 100%)}
.hero:before{content:"";position:absolute;inset:0;pointer-events:none;opacity:.24;background-image:linear-gradient(rgba(255,255,255,.025) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.025) 1px,transparent 1px);background-size:48px 48px;mask-image:linear-gradient(to bottom,#000,transparent 88%)}
.hero-grid{position:relative;display:grid;grid-template-columns:minmax(0,1.02fr) minmax(440px,.98fr);gap:70px;align-items:center}
.hero h1{font-size:clamp(54px,7.2vw,96px);line-height:.93;letter-spacing:-.067em;margin:20px 0 26px;max-width:800px;font-weight:760}
.hero h1 .quiet{color:#8993a5}
.hero-copy{font-size:clamp(18px,1.7vw,22px);line-height:1.5;color:#aeb6c4;max-width:680px;margin:0}
.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}
.hero-note{display:flex;align-items:center;gap:10px;margin-top:30px;color:#7f899b;font-size:13px}.hero-note i{width:6px;height:6px;border-radius:50%;background:var(--warning)}

.execution-card{position:relative;background:linear-gradient(180deg,rgba(18,23,34,.95),rgba(11,14,20,.96));border:1px solid rgba(255,255,255,.12);border-radius:24px;box-shadow:var(--shadow);overflow:hidden}
.execution-card:before{content:"";position:absolute;inset:0;background:linear-gradient(110deg,transparent 20%,rgba(124,140,255,.06),transparent 58%);pointer-events:none}
.exec-top{height:55px;display:flex;align-items:center;justify-content:space-between;padding:0 18px;border-bottom:1px solid var(--line);font-size:12px;color:#8590a2}.exec-top-left{display:flex;align-items:center;gap:9px}.traffic{display:flex;gap:5px}.traffic i{width:7px;height:7px;border-radius:50%;background:#343a46}.traffic i:first-child{background:#5c6675}
.exec-body{padding:24px}
.exec-row{display:grid;grid-template-columns:92px 1fr auto;gap:16px;align-items:center;padding:18px 0;border-bottom:1px solid var(--line)}.exec-row:last-child{border-bottom:0}.exec-label{font:11px/1.25 var(--mono);color:#6e7889;text-transform:uppercase;letter-spacing:.08em}.exec-main b{display:block;font-size:15px;margin-bottom:3px}.exec-main span{font-size:13px;color:#7e899b}.exec-pill{font:11px/1 var(--mono);padding:8px 9px;border:1px solid var(--line-strong);border-radius:999px;color:#a7b0bf}.exec-pill.protected{color:#b7c0ff;border-color:rgba(124,140,255,.34);background:rgba(124,140,255,.08)}.exec-pill.normal{color:#8eeed9;border-color:rgba(77,226,197,.28);background:rgba(77,226,197,.065)}
.exec-window{margin-top:22px;background:#080b10;border:1px solid var(--line);border-radius:15px;padding:16px}.exec-window-head{display:flex;justify-content:space-between;gap:18px;color:#758092;font:11px/1.2 var(--mono);margin-bottom:15px}.timeline{position:relative;height:40px}.timeline:before{content:"";position:absolute;left:0;right:0;top:18px;height:2px;background:#242b36}.timeline .guard{position:absolute;left:21%;width:38%;top:13px;height:12px;border-radius:99px;background:linear-gradient(90deg,var(--accent),#a08cff);box-shadow:0 0 28px rgba(124,140,255,.25)}.timeline .dot{position:absolute;top:13px;width:12px;height:12px;border-radius:50%;background:#e7ebf1;border:3px solid #697385}.timeline .dot.start{left:0}.timeline .dot.end{left:59%;border-color:var(--accent-2)}.timeline-labels{display:flex;justify-content:space-between;color:#5d6878;font:10px/1 var(--mono)}
.exec-caption{padding:0 24px 22px;color:#687386;font-size:12px}

.proof{border-top:1px solid var(--line);border-bottom:1px solid var(--line);background:#090c11}.proof-grid{display:grid;grid-template-columns:repeat(5,1fr)}.proof-item{padding:23px 18px;border-right:1px solid var(--line);text-align:center}.proof-item:last-child{border-right:0}.proof-item b{font-size:13px;color:#dce1ea}.proof-item span{display:block;font-size:11px;color:#667183;margin-top:4px}

.contrast{display:grid;grid-template-columns:1fr 1fr;gap:16px}.contrast-panel{min-height:360px;border:1px solid var(--line);border-radius:20px;padding:28px;position:relative;overflow:hidden;background:#0b0f15}.contrast-panel.good{background:linear-gradient(150deg,rgba(77,226,197,.08),#0b0f15 42%)}.contrast-panel.bad{background:linear-gradient(150deg,rgba(255,120,120,.05),#0b0f15 42%)}.contrast-title{display:flex;align-items:center;justify-content:space-between;gap:20px;margin-bottom:42px}.contrast-title b{font-size:17px}.state-tag{font:11px/1 var(--mono);padding:7px 9px;border-radius:999px;background:rgba(255,255,255,.04);border:1px solid var(--line)}.sequence{display:grid;gap:14px}.seq-row{display:grid;grid-template-columns:34px 1fr auto;gap:12px;align-items:center}.seq-n{width:30px;height:30px;border:1px solid var(--line-strong);border-radius:8px;display:grid;place-items:center;color:#6f7a8c;font:10px/1 var(--mono)}.seq-row b{font-size:14px}.seq-row span{font-size:12px;color:#687386}.seq-result{margin-top:32px;padding-top:21px;border-top:1px solid var(--line);font-size:13px;color:#8d97a8}.good .seq-result strong{color:#93efda}.bad .seq-result strong{color:#e9a0a0}

.pipeline{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);border-radius:22px;overflow:hidden;background:#0a0d12}.pipe-step{padding:26px 22px;min-height:205px;border-right:1px solid var(--line);position:relative}.pipe-step:last-child{border-right:0}.pipe-step .num{font:11px/1 var(--mono);color:#667183}.pipe-step h3{font-size:18px;margin:44px 0 10px}.pipe-step p{font-size:13px;color:#778295;margin:0}.pipe-step:after{content:"→";position:absolute;right:-9px;top:44px;width:18px;height:18px;border-radius:50%;background:#151a23;color:#8792a4;display:grid;place-items:center;font-size:11px;z-index:2;border:1px solid var(--line)}.pipe-step:last-child:after{display:none}

.policy-list{border-top:1px solid var(--line)}.policy-row{display:grid;grid-template-columns:1.25fr 1fr .7fr;gap:28px;align-items:center;padding:22px 0;border-bottom:1px solid var(--line)}.policy-row.head{padding:13px 0;color:#667183;font:10px/1 var(--mono);text-transform:uppercase;letter-spacing:.08em}.policy-name b{display:block;font-size:15px}.policy-name span{font-size:12px;color:#697486}.decision{font:12px/1 var(--mono);color:#aab3c2}.decision.delay{color:#afb9ff}.delay{font:12px/1 var(--mono);text-align:right;color:#7b8698}

.rail{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.feature{padding:28px;border-top:1px solid var(--line-strong);background:linear-gradient(180deg,rgba(255,255,255,.018),transparent)}.feature-icon{width:38px;height:38px;border:1px solid var(--line-strong);border-radius:10px;display:grid;place-items:center;background:rgba(255,255,255,.02);margin-bottom:28px}.feature-icon svg{width:19px;height:19px;stroke:#c8cfda}.feature h3{font-size:18px;margin:0 0 10px}.feature p{font-size:14px;color:#7e899a;margin:0}

.code-grid{display:grid;grid-template-columns:.85fr 1.15fr;gap:46px;align-items:center}.code-copy h2{font-size:clamp(38px,5vw,64px);line-height:1;letter-spacing:-.05em;margin:16px 0 22px}.code-copy p{color:var(--muted);font-size:17px}.code-box{border:1px solid var(--line-strong);border-radius:20px;background:#080b10;overflow:hidden;box-shadow:0 18px 60px rgba(0,0,0,.22)}.code-top{height:48px;border-bottom:1px solid var(--line);display:flex;align-items:center;justify-content:space-between;padding:0 16px;color:#707b8c;font:11px/1 var(--mono)}.code-box pre{margin:0;padding:22px 20px 25px;overflow:auto;color:#bec6d3;font:12px/1.7 var(--mono)}.code-box .key{color:#9aa7ff}.code-box .str{color:#72dec6}.code-box .num{color:#e6c277}

.cta{position:relative;overflow:hidden;border:1px solid var(--line-strong);border-radius:28px;padding:clamp(36px,6vw,72px);background:radial-gradient(circle at 82% 20%,rgba(124,140,255,.22),transparent 34%),linear-gradient(135deg,#101620,#0a0d12 58%)}.cta h2{font-size:clamp(42px,5vw,70px);line-height:.98;letter-spacing:-.055em;margin:14px 0 20px;max-width:760px}.cta p{max-width:650px;color:#9da6b5;font-size:17px}.cta-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:30px}

.page-hero{padding:clamp(88px,10vw,142px) 0 72px;background:radial-gradient(circle at 80% 20%,rgba(124,140,255,.10),transparent 30%)}.page-hero h1{font-size:clamp(52px,6.5vw,90px);line-height:.94;letter-spacing:-.065em;margin:18px 0 25px;max-width:980px}.page-hero p{font-size:20px;color:#a0a9b7;max-width:760px;margin:0}.crumb{font:11px/1 var(--mono);color:#667183;text-transform:uppercase;letter-spacing:.09em}.crumb a{text-decoration:none;color:#8994a5}.page-grid{display:grid;grid-template-columns:260px minmax(0,1fr);gap:70px}.side-index{position:sticky;top:112px;height:max-content}.side-index a{display:block;padding:9px 0;color:#6f7a8c;text-decoration:none;font-size:13px}.side-index a:hover{color:#fff}.article{max-width:840px}.article section{padding:0 0 72px;scroll-margin-top:110px}.article h2{font-size:clamp(30px,4vw,48px);line-height:1.02;letter-spacing:-.04em;margin:0 0 20px}.article h3{font-size:20px;margin:34px 0 12px}.article p,.article li{color:#929cad;font-size:16px}.article ul{padding-left:20px}.article code{font:12px/1 var(--mono);color:#bac3ff;background:rgba(124,140,255,.09);padding:3px 6px;border-radius:5px}.note{padding:20px 22px;border-left:2px solid var(--accent);background:rgba(124,140,255,.055);color:#9da7b8;margin:24px 0}.doc-links{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:24px}.doc-link{border:1px solid var(--line);border-radius:14px;padding:18px;text-decoration:none}.doc-link b{display:block;font-size:14px;margin-bottom:4px}.doc-link span{font-size:12px;color:#6f7b8d}.status-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.status-card{border:1px solid var(--line);border-radius:16px;padding:22px;background:#0b0f15}.status-card .state{font:10px/1 var(--mono);text-transform:uppercase;color:#6e7889}.status-card h3{font-size:18px;margin:20px 0 8px}.status-card p{font-size:13px;color:#778295;margin:0}.status-card.done .state{color:#7de4ca}.status-card.pending .state{color:#efca77}

.footer{padding:66px 0 34px;border-top:1px solid var(--line);background:#080a0e}.footer-grid{display:grid;grid-template-columns:1.5fr repeat(3,.7fr);gap:46px}.footer-brand p{max-width:360px;color:#697486;font-size:13px;margin:16px 0 0}.footer-col b{display:block;font-size:12px;margin-bottom:15px;color:#b9c1cc}.footer-col a{display:block;color:#717c8d;text-decoration:none;font-size:13px;padding:5px 0}.footer-col a:hover{color:#fff}.footer-bottom{display:flex;justify-content:space-between;gap:20px;margin-top:50px;padding-top:20px;border-top:1px solid var(--line);color:#596475;font:11px/1.5 var(--mono)}

.notfound{min-height:70vh;display:grid;place-items:center;text-align:center;padding:80px 0}.notfound h1{font-size:clamp(80px,16vw,190px);letter-spacing:-.09em;line-height:.8;margin:0;color:#242b37}.notfound h2{font-size:28px;margin:30px 0 10px}.notfound p{color:#7b8697;margin:0 0 24px}

@media(max-width:980px){
  .nav-links,.nav-status{display:none}.menu{display:block}
  .hero-grid{grid-template-columns:1fr;gap:52px}.execution-card{max-width:720px}
  .section-head{grid-template-columns:1fr;gap:22px}.section-head p{max-width:720px}
  .proof-grid{grid-template-columns:repeat(3,1fr)}.proof-item:nth-child(3){border-right:0}.proof-item:nth-child(n+4){border-top:1px solid var(--line)}
  .pipeline{grid-template-columns:1fr 1fr}.pipe-step:nth-child(2){border-right:0}.pipe-step:nth-child(1),.pipe-step:nth-child(2){border-bottom:1px solid var(--line)}.pipe-step:nth-child(2):after{display:none}
  .rail{grid-template-columns:1fr 1fr}.code-grid{grid-template-columns:1fr}.page-grid{grid-template-columns:1fr}.side-index{position:static;display:flex;gap:18px;overflow:auto;border-bottom:1px solid var(--line);padding-bottom:12px}.side-index a{white-space:nowrap}.footer-grid{grid-template-columns:1fr 1fr}
}
@media(max-width:700px){
  .navbar{height:66px}.brand-word{font-size:16px}.hero{padding-top:74px}.hero h1{font-size:clamp(50px,16vw,74px)}
  .exec-row{grid-template-columns:70px 1fr}.exec-pill{grid-column:2;width:max-content}.contrast{grid-template-columns:1fr}.proof-grid{grid-template-columns:1fr 1fr}.proof-item:nth-child(2n){border-right:0}.proof-item:nth-child(3){border-right:1px solid var(--line)}.proof-item:nth-child(n+3){border-top:1px solid var(--line)}
  .pipeline{grid-template-columns:1fr}.pipe-step{border-right:0;border-bottom:1px solid var(--line)!important}.pipe-step:last-child{border-bottom:0!important}.pipe-step:after{display:none}
  .policy-row{grid-template-columns:1fr auto;gap:8px 18px}.policy-row.head{display:none}.policy-row .decision{grid-column:1}.policy-row .delay{grid-column:2;grid-row:1/3;align-self:center}.rail{grid-template-columns:1fr}.doc-links{grid-template-columns:1fr}.status-grid{grid-template-columns:1fr}.footer-grid{grid-template-columns:1fr}.footer-bottom{flex-direction:column}.page-hero h1{font-size:clamp(48px,15vw,72px)}
}
@media(prefers-reduced-motion:no-preference){.execution-card{animation:float 8s ease-in-out infinite}@keyframes float{50%{transform:translateY(-5px)}}}
`;

const icons = {
  arrow: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  check: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M5 12.5 9.2 17 19 7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  shield: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 3 19 6v5c0 4.6-2.8 8-7 10-4.2-2-7-5.4-7-10V6l7-3Z" stroke="currentColor" stroke-width="1.6"/><path d="m9 12 2 2 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  route: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="6" cy="6" r="2" stroke="currentColor" stroke-width="1.6"/><circle cx="18" cy="18" r="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 6h4a3 3 0 0 1 3 3v6a3 3 0 0 0 3 3M6 8v8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`,
  code: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m8 7-5 5 5 5M16 7l5 5-5 5M14 4l-4 16" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  layers: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m12 3 9 5-9 5-9-5 9-5Z" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="m3 12 9 5 9-5M3 16l9 5 9-5" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/></svg>`,
  lock: `<svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="5" y="10" width="14" height="10" rx="2" stroke="currentColor" stroke-width="1.6"/><path d="M8 10V7a4 4 0 0 1 8 0v3M12 14v2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>`
};

function logoMark() {
  return `<svg class="brand-mark" viewBox="0 0 32 32" fill="none" aria-hidden="true"><rect x="1" y="1" width="30" height="30" rx="9" fill="#10151e" stroke="rgba(255,255,255,.14)"/><path d="M9 10.2 13.8 16 9 21.8" stroke="#9ba7ff" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="m23 10.2-4.8 5.8 4.8 5.8" stroke="#60e1c7" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 16h6" stroke="#f5f7fb" stroke-width="2.2" stroke-linecap="round"/></svg>`;
}

function header(active = "") {
  const nav = [
    ["product", "/product", "Product"],
    ["architecture", "/architecture", "Architecture"],
    ["security", "/security", "Security"],
    ["docs", "/docs", "Docs"],
    ["status", "/status", "Status"]
  ];
  const links = nav.map(([id, href, label]) => `<a class="${active === id ? "active" : ""}" href="${href}">${label}</a>`).join("");
  return `<header class="site-header"><div class="shell navbar">
    <a class="brand" href="/" aria-label="XGuard ACE home">${logoMark()}<div class="brand-word">XGuard <span>ACE</span></div></a>
    <nav class="nav-links" aria-label="Primary navigation">${links}</nav>
    <div class="nav-actions"><div class="nav-status"><i></i>Early-access candidate</div><a class="btn secondary" href="${GITHUB}">GitHub</a>
      <details class="menu"><summary aria-label="Open menu"><svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg></summary><div class="menu-panel">${links}<a href="${GITHUB}">GitHub</a></div></details>
    </div>
  </div></header>`;
}

function footer() {
  return `<footer class="footer"><div class="shell"><div class="footer-grid">
    <div class="footer-brand"><a class="brand" href="/">${logoMark()}<div class="brand-word">XGuard <span>ACE</span></div></a><p>Deterministic application-level scheduling protection designed for BAM on Solana. Built for technical review before production activation.</p></div>
    <div class="footer-col"><b>Product</b><a href="/product">Overview</a><a href="/architecture">Architecture</a><a href="/security">Security</a><a href="/status">Status</a></div>
    <div class="footer-col"><b>Developers</b><a href="/docs">Docs</a><a href="/spec.json">Machine spec</a><a href="${GITHUB}">Source</a><a href="${ACE_DISCUSSION}">ACE design basis</a></div>
    <div class="footer-col"><b>Protocol</b><a href="${BAM}">BAM</a><a href="/.well-known/security.txt">Security contact</a><a href="/sitemap.xml">Sitemap</a></div>
  </div><div class="footer-bottom"><span>© 2026 XGuard contributors · Apache-2.0</span><span>BAM early-access candidate · Not production-active</span></div></div></footer>`;
}

function shellPage({ title, description, active = "", path = "/", body, status = 200 }) {
  const canonical = `${SITE}${path}`;
  const html = `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="theme-color" content="#07090d">
<title>${title}</title><meta name="description" content="${description}"><link rel="canonical" href="${canonical}"><link rel="icon" href="/favicon.svg" type="image/svg+xml">
<meta property="og:type" content="website"><meta property="og:site_name" content="XGuard ACE"><meta property="og:title" content="${title}"><meta property="og:description" content="${description}"><meta property="og:url" content="${canonical}"><meta property="og:image" content="${SITE}/og.svg">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${title}"><meta name="twitter:description" content="${description}"><meta name="twitter:image" content="${SITE}/og.svg">
<style>${CSS}</style></head><body data-site-version="${SITE_VERSION}">${header(active)}<main>${body}</main>${footer()}</body></html>`;
  return new Response(html, { status, headers: htmlHeaders(status === 200 ? 300 : 30) });
}

function htmlHeaders(maxAge = 300) {
  return {
    "content-type": "text/html; charset=utf-8",
    "cache-control": `public, max-age=${maxAge}`,
    "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY"
  };
}

function json(value, status = 200) {
  return new Response(JSON.stringify(value, null, 2), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=60", "x-content-type-options": "nosniff" } });
}

function executionVisual() {
  return `<div class="execution-card" aria-label="Reference XGuard scheduling decision">
    <div class="exec-top"><div class="exec-top-left"><div class="traffic"><i></i><i></i><i></i></div><span class="mono">reference decision</span></div><span class="mono">xguard-core</span></div>
    <div class="exec-body">
      <div class="exec-row"><div class="exec-label">Incoming</div><div class="exec-main"><b>Protected top-level call</b><span>Enrolled application matched</span></div><div class="exec-pill protected">MATCH</div></div>
      <div class="exec-row"><div class="exec-label">Policy</div><div class="exec-main"><b>No bypass marker</b><span>Protected-by-default rule applies</span></div><div class="exec-pill protected">DELAY</div></div>
      <div class="exec-row"><div class="exec-label">Output</div><div class="exec-main"><b>Scheduler admission</b><span>Transaction continues after bounded guard</span></div><div class="exec-pill normal">20 ms</div></div>
      <div class="exec-window"><div class="exec-window-head"><span>0 ms</span><span>configured guard window</span><span>50 ms</span></div><div class="timeline"><i class="dot start"></i><span class="guard"></span><i class="dot end"></i></div><div class="timeline-labels"><span>arrive</span><span>guard</span><span>release</span></div></div>
    </div><div class="exec-caption">Illustrative fixture output — not live BAM traffic.</div>
  </div>`;
}

function homePage() {
  const body = `<section class="hero"><div class="shell hero-grid"><div>
    <div class="eyebrow">Execution protection for BAM</div>
    <h1>Protect quotes <span class="quiet">before execution.</span></h1>
    <p class="hero-copy">XGuard ACE is a deterministic scheduling guard for opt-in Solana applications: protected flow receives a bounded 10–50 ms delay while explicitly marked critical instructions stay on the normal path.</p>
    <div class="hero-actions"><a class="btn primary" href="/product">Explore the product ${icons.arrow}</a><a class="btn secondary" href="${GITHUB}">Review source</a></div>
    <div class="hero-note"><i></i>Designed for BAM early-access review. No production traffic is claimed.</div>
  </div>${executionVisual()}</div></section>

  <section class="proof"><div class="shell proof-grid">
    <div class="proof-item"><b>Pure Rust</b><span>critical policy engine</span></div><div class="proof-item"><b>Deterministic</b><span>same input, same decision</span></div><div class="proof-item"><b>No custody</b><span>funds never touch XGuard</span></div><div class="proof-item"><b>No client install</b><span>routing-layer placement</span></div><div class="proof-item"><b>No mutation</b><span>transactions remain unchanged</span></div>
  </div></section>

  <section class="section"><div class="shell"><div class="section-head"><div><div class="kicker">The problem</div><h2>Fast execution can still be bad execution.</h2></div><p>When a market moves faster than a quote refresh, an aggressive trade can land against stale state. The result is toxic flow for makers and degraded market quality for applications.</p></div>
    <div class="contrast"><div class="contrast-panel bad"><div class="contrast-title"><b>Without a guard</b><span class="state-tag">stale state exposed</span></div><div class="sequence"><div class="seq-row"><div class="seq-n">01</div><div><b>Quote is resting</b><span>market maker publishes price</span></div></div><div class="seq-row"><div class="seq-n">02</div><div><b>Market moves</b><span>quote becomes stale</span></div></div><div class="seq-row"><div class="seq-n">03</div><div><b>Taker lands first</b><span>maker refresh loses the race</span></div></div></div><div class="seq-result"><strong>Outcome:</strong> stale-quote exposure remains possible.</div></div>
      <div class="contrast-panel good"><div class="contrast-title"><b>With XGuard ACE</b><span class="state-tag">bounded protection</span></div><div class="sequence"><div class="seq-row"><div class="seq-n">01</div><div><b>Application opts in</b><span>explicit program-level rule</span></div></div><div class="seq-row"><div class="seq-n">02</div><div><b>Protected flow waits</b><span>10–50 ms configured guard</span></div></div><div class="seq-row"><div class="seq-n">03</div><div><b>Critical updates bypass</b><span>explicit markers stay fast</span></div></div></div><div class="seq-result"><strong>Outcome:</strong> applications gain deterministic execution control.</div></div>
    </div>
  </div></section>

  <section class="section soft"><div class="shell"><div class="section-head"><div><div class="kicker">Mechanism</div><h2>One policy decision before scheduler admission.</h2></div><p>XGuard does not become a wallet proxy, RPC gateway, or trading bot. It is deliberately narrow: inspect the routing context, return a deterministic scheduling decision, and get out of the way.</p></div>
    <div class="pipeline"><div class="pipe-step"><span class="num">01</span><h3>Transaction enters BAM</h3><p>Routing context exposes top-level calls and referenced program keys.</p></div><div class="pipe-step"><span class="num">02</span><h3>Policy is evaluated</h3><p>Program id, marker rules, indirect references, and composition are checked.</p></div><div class="pipe-step"><span class="num">03</span><h3>Decision is returned</h3><p>Normal path or a bounded application-configured delay.</p></div><div class="pipe-step"><span class="num">04</span><h3>Scheduler continues</h3><p>No signing, custody, transaction mutation, or model inference.</p></div></div>
  </div></section>

  <section class="section"><div class="shell"><div class="section-head"><div><div class="kicker">Policy</div><h2>Protected by default. Bypass only when explicit.</h2></div><p>The policy is conservative by design. Registered applications define exact top-level bypass markers; otherwise matching flow remains protected.</p></div>
    <div class="policy-list"><div class="policy-row head"><div>Observed state</div><div>Decision</div><div>Delay</div></div>
      <div class="policy-row"><div class="policy-name"><b>Unknown program</b><span>not enrolled in XGuard policy</span></div><div class="decision">normal path</div><div class="delay">0 ms</div></div>
      <div class="policy-row"><div class="policy-name"><b>Protected top-level call</b><span>enrolled program, no bypass marker</span></div><div class="decision delay">bounded delay</div><div class="delay">10–50 ms</div></div>
      <div class="policy-row"><div class="policy-name"><b>Explicit bypass marker</b><span>application-defined fast path</span></div><div class="decision">normal path</div><div class="delay">0 ms</div></div>
      <div class="policy-row"><div class="policy-name"><b>Indirect / CPI reference</b><span>conservative protected handling</span></div><div class="decision delay">bounded delay</div><div class="delay">10–50 ms</div></div>
      <div class="policy-row"><div class="policy-name"><b>Multiple enrolled programs</b><span>composed transaction</span></div><div class="decision delay">maximum rule wins</div><div class="delay">max match</div></div>
    </div>
  </div></section>

  <section class="section soft"><div class="shell"><div class="section-head"><div><div class="kicker">Reviewability</div><h2>Critical infrastructure should be boring in the right places.</h2></div><p>The core avoids probabilistic behavior and unnecessary dependencies because execution policy is easier to trust when every decision is reproducible.</p></div><div class="rail">
    <div class="feature"><div class="feature-icon">${icons.code}</div><h3>Deterministic core</h3><p>Pure Rust classification with no wall clock, random state, network calls, databases, or model inference.</p></div>
    <div class="feature"><div class="feature-icon">${icons.shield}</div><h3>Narrow security surface</h3><p>XGuard neither signs nor mutates transactions and never takes custody of user funds.</p></div>
    <div class="feature"><div class="feature-icon">${icons.layers}</div><h3>Composable rules</h3><p>When several enrolled programs match, the maximum delay wins to prevent composition bypass.</p></div>
  </div></div></section>

  <section class="section"><div class="shell code-grid"><div class="code-copy"><div class="kicker">Developer surface</div><h2>Readable enough to audit in minutes.</h2><p>The reference implementation exposes a compact JSON policy and a fixture-driven simulator. Review the exact decision rules before any BAM adapter is wired in.</p><div class="hero-actions"><a class="btn primary" href="/docs">Open docs ${icons.arrow}</a><a class="btn secondary" href="/architecture">Architecture</a></div></div>
    <div class="code-box"><div class="code-top"><span>examples/rules.json</span><span>reference policy</span></div><pre>{
  <span class="key">"rules"</span>: [
    {
      <span class="key">"program_id"</span>: <span class="str">"111111...1111"</span>,
      <span class="key">"bypass_markers"</span>: [
        { <span class="key">"data_offset"</span>: <span class="num">0</span>, <span class="key">"bytes"</span>: [<span class="num">7</span>] }
      ],
      <span class="key">"delay_ms"</span>: <span class="num">20</span>
    }
  ]
}</pre></div>
  </div></section>

  <section class="section"><div class="shell"><div class="cta"><div class="eyebrow">Current stage</div><h2>Built for BAM review. Ready for the official integration boundary.</h2><p>The policy engine, simulator, tests, security model, and public specification are implemented. Production activation still depends on BAM's supported ACE/plugin interface and early-access approval.</p><div class="cta-actions"><a class="btn primary" href="/status">View implementation status ${icons.arrow}</a><a class="btn secondary" href="${GITHUB}">Review repository</a></div></div></div></section>`;
  return shellPage({ title: "XGuard ACE — Deterministic Execution Protection for BAM", description: "Deterministic application-level stale-quote protection designed for BAM on Solana.", path: "/", body });
}

function productPage() {
  const body = `<section class="page-hero"><div class="shell"><div class="crumb"><a href="/">XGuard</a> / Product</div><div class="eyebrow" style="margin-top:28px">Application-controlled execution</div><h1>Selective protection for latency-sensitive flow.</h1><p>XGuard ACE gives an opted-in application one deterministic policy primitive: protect ordinary flow with a bounded delay while explicitly marked critical instructions continue immediately.</p></div></section>
  <section class="section"><div class="shell page-grid"><aside class="side-index"><a href="#problem">Problem</a><a href="#model">Control model</a><a href="#applications">Designed for</a><a href="#non-goals">Non-goals</a></aside><article class="article">
    <section id="problem"><div class="kicker">Problem</div><h2>Execution order becomes part of application quality.</h2><p>Trading applications can expose market makers to stale-quote flow when taker transactions arrive before price-refresh or other critical instructions. BAM's public ACE discussion describes application-level speed bumps as one way to make that ordering explicit.</p><div class="note">XGuard does not claim that every market needs a delay. The application must opt in and define the exact fast-path markers appropriate for its own program ABI.</div></section>
    <section id="model"><div class="kicker">Control model</div><h2>One rule, three outcomes.</h2><div class="policy-list"><div class="policy-row"><div class="policy-name"><b>Unrelated flow</b><span>program is not enrolled</span></div><div class="decision">normal path</div><div class="delay">0 ms</div></div><div class="policy-row"><div class="policy-name"><b>Critical marked flow</b><span>exact bypass marker matched</span></div><div class="decision">normal path</div><div class="delay">0 ms</div></div><div class="policy-row"><div class="policy-name"><b>Protected flow</b><span>enrolled application, no bypass</span></div><div class="decision delay">bounded delay</div><div class="delay">10–50 ms</div></div></div></section>
    <section id="applications"><div class="kicker">Designed for</div><h2>Applications where tens of milliseconds can change who absorbs the risk.</h2><div class="rail" style="grid-template-columns:1fr 1fr"><div class="feature"><div class="feature-icon">${icons.route}</div><h3>Trading applications</h3><p>Application-owned scheduling rules can separate protected taker flow from explicitly marked critical updates.</p></div><div class="feature"><div class="feature-icon">${icons.layers}</div><h3>Composable programs</h3><p>Maximum-delay composition avoids allowing a shorter rule to become a bypass path for a longer one.</p></div></div></section>
    <section id="non-goals"><div class="kicker">Non-goals</div><h2>What XGuard deliberately does not become.</h2><ul><li>Not a wallet, RPC endpoint, or custody layer.</li><li>Not a transaction-signing service.</li><li>Not a trading strategy or market-making bot.</li><li>Not an AI classifier in the execution path.</li><li>Not a reverse-engineered BAM production dependency.</li></ul><div class="doc-links"><a class="doc-link" href="/architecture"><b>Read architecture</b><span>Placement, data path, integration boundary →</span></a><a class="doc-link" href="/security"><b>Read security model</b><span>Invariants, failure behavior, abuse controls →</span></a></div></section>
  </article></div></section>`;
  return shellPage({ title: "Product — XGuard ACE", description: "How XGuard ACE provides deterministic application-controlled execution protection for BAM.", active: "product", path: "/product", body });
}

function architecturePage() {
  const body = `<section class="page-hero"><div class="shell"><div class="crumb"><a href="/">XGuard</a> / Architecture</div><div class="eyebrow" style="margin-top:28px">Execution path</div><h1>A pure policy core behind a narrow BAM adapter.</h1><p>The architecture isolates application policy from BAM-specific routing, registration, attestation, and accounting so the critical logic remains testable without inventing an unofficial production interface.</p></div></section>
  <section class="section"><div class="shell page-grid"><aside class="side-index"><a href="#path">Data path</a><a href="#core">Core model</a><a href="#boundary">Integration boundary</a><a href="#determinism">Determinism</a></aside><article class="article">
    <section id="path"><div class="kicker">Data path</div><h2>Placement before scheduler admission.</h2><p>The intended runtime placement is inside BAM's routing/scheduling environment. An adapter extracts the minimal transaction view, calls the policy core, then returns a delay decision.</p><div class="pipeline" style="margin-top:30px"><div class="pipe-step"><span class="num">01</span><h3>Incoming transaction</h3><p>Transaction arrives at BAM routing.</p></div><div class="pipe-step"><span class="num">02</span><h3>BAM adapter</h3><p>Extracts top-level calls and referenced keys.</p></div><div class="pipe-step"><span class="num">03</span><h3>xguard-core</h3><p>Returns deterministic delay decision.</p></div><div class="pipe-step"><span class="num">04</span><h3>Scheduler</h3><p>Normal or delayed admission path.</p></div></div></section>
    <section id="core"><div class="kicker">Core model</div><h2>Small input. Small output.</h2><p><code>classify(config, transaction)</code> receives validated application rules and a minimal transaction view. It returns only the chosen <code>delay_ms</code> and stable rule matches for auditability.</p><div class="note">The core has no BAM SDK dependency, network client, RPC connection, database, model runtime, or persistent state.</div></section>
    <section id="boundary"><div class="kicker">Integration boundary</div><h2>No invented production API.</h2><p>BAM's public ACE design discusses application registration and plugin execution, but XGuard intentionally leaves the production adapter as a boundary until BAM provides the supported interface for the early-access cohort.</p><ul><li>Application registration source of truth: supplied by BAM.</li><li>TEE / attestation expectations: supplied by BAM.</li><li>Scheduler adapter contract: supplied by BAM.</li><li>Fee/accounting hooks: supplied by BAM if available.</li></ul></section>
    <section id="determinism"><div class="kicker">Determinism</div><h2>The decision is a pure function.</h2><p>There are no wall-clock reads, random values, network calls, mutable globals, or external storage reads. Identical validated policy plus identical transaction view yields the same classification.</p><div class="doc-links"><a class="doc-link" href="${GITHUB}/blob/main/docs/ARCHITECTURE.md"><b>Architecture source document</b><span>Read the repository document →</span></a><a class="doc-link" href="/docs"><b>Run the simulator</b><span>Reference fixtures and command →</span></a></div></section>
  </article></div></section>`;
  return shellPage({ title: "Architecture — XGuard ACE", description: "The deterministic XGuard ACE policy core and its intended BAM integration boundary.", active: "architecture", path: "/architecture", body });
}

function securityPage() {
  const body = `<section class="page-hero"><div class="shell"><div class="crumb"><a href="/">XGuard</a> / Security</div><div class="eyebrow" style="margin-top:28px">Security model</div><h1>Minimize authority. Bound every decision.</h1><p>XGuard is designed to influence scheduling only for explicitly enrolled applications. It does not sign, mutate, simulate, or custody transactions or funds.</p></div></section>
  <section class="section"><div class="shell page-grid"><aside class="side-index"><a href="#invariants">Invariants</a><a href="#bounds">Resource bounds</a><a href="#failure">Failure behavior</a><a href="#abuse">Abuse controls</a><a href="#report">Report</a></aside><article class="article">
    <section id="invariants"><div class="kicker">Invariants</div><h2>The rules that should never be ambiguous.</h2><ul><li>Non-enrolled programs are never delayed by XGuard.</li><li>Configured delay remains within 10–50 ms.</li><li>Bypass requires an explicit marker on every matching top-level call.</li><li>Indirect / CPI-style references are handled conservatively.</li><li>Composed transactions use the maximum matching delay.</li><li>The critical-path decision is deterministic.</li><li>XGuard never signs, mutates, or takes custody of a transaction.</li></ul></section>
    <section id="bounds"><div class="kicker">Resource bounds</div><h2>Configuration is deliberately finite.</h2><p>The reference engine rejects more than 4,096 application rules, more than 32 bypass markers per rule, or markers longer than 16 bytes. BAM may choose tighter production limits.</p></section>
    <section id="failure"><div class="kicker">Failure behavior</div><h2>Plugin faults must not become network faults.</h2><p>The core itself has no external dependencies. A production adapter should preserve an operator-defined fallback so an XGuard fault cannot disrupt unrelated transaction ingestion.</p><div class="note">Production fallback semantics must be agreed with BAM. The public reference implementation does not pretend to define operator policy for BAM nodes.</div></section>
    <section id="abuse"><div class="kicker">Abuse controls</div><h2>Think about the registry and queue, not just classification.</h2><h3>Registration spam</h3><p>A permissionless registry needs economic or governance controls to prevent unbounded registrations.</p><h3>Delayed-pool pressure</h3><p>The BAM adapter must enforce hard queue and memory limits where transaction size and scheduler pressure are visible.</p><h3>Marker ambiguity</h3><p>Markers use exact byte matches at explicit offsets. There is no heuristic or prefix guessing.</p></section>
    <section id="report"><div class="kicker">Report</div><h2>Security contact</h2><p>Responsible disclosure can be sent to <a href="mailto:mo.elayyan2023@gmail.com">mo.elayyan2023@gmail.com</a>. The canonical security file is available at <a href="/.well-known/security.txt">/.well-known/security.txt</a>.</p><div class="doc-links"><a class="doc-link" href="${GITHUB}/blob/main/docs/SECURITY.md"><b>Security source document</b><span>Read the full repository model →</span></a><a class="doc-link" href="/status"><b>Implementation status</b><span>See what is and is not production-ready →</span></a></div></section>
  </article></div></section>`;
  return shellPage({ title: "Security — XGuard ACE", description: "Security invariants, resource bounds, failure behavior, and abuse controls for XGuard ACE.", active: "security", path: "/security", body });
}

function docsPage() {
  const body = `<section class="page-hero"><div class="shell"><div class="crumb"><a href="/">XGuard</a> / Docs</div><div class="eyebrow" style="margin-top:28px">Reference implementation</div><h1>Run the policy engine before you trust the claim.</h1><p>The repository includes a pure Rust core, correctness tests, and a fixture-driven simulator. These docs cover the public reference surface; the official BAM adapter is intentionally pending.</p></div></section>
  <section class="section"><div class="shell page-grid"><aside class="side-index"><a href="#run">Run</a><a href="#rules">Rules</a><a href="#transactions">Transactions</a><a href="#output">Output</a><a href="#more">More docs</a></aside><article class="article">
    <section id="run"><div class="kicker">Run locally</div><h2>One command for the reference fixtures.</h2><div class="code-box"><div class="code-top"><span>terminal</span><span>repository root</span></div><pre>cargo run -p xguard-sim -- examples/rules.json examples/transactions.json</pre></div><p style="margin-top:18px">Validation is also available through <code>cargo test --workspace</code>, <code>cargo fmt --all --check</code>, and Clippy in CI.</p></section>
    <section id="rules"><div class="kicker">Rules</div><h2>Define the enrolled program and exact bypass marker.</h2><div class="code-box"><div class="code-top"><span>examples/rules.json</span><span>JSON</span></div><pre>{
  "rules": [
    {
      "program_id": "11111111111111111111111111111111",
      "bypass_markers": [
        { "data_offset": 0, "bytes": [7] }
      ],
      "delay_ms": 20
    }
  ]
}</pre></div></section>
    <section id="transactions"><div class="kicker">Transaction view</div><h2>The simulator uses only the fields the policy needs.</h2><p>Each fixture contains top-level instructions and referenced account/program keys. The BAM adapter is expected to construct this minimal view from the actual routing context.</p></section>
    <section id="output"><div class="kicker">Output</div><h2>A delay decision plus auditable matches.</h2><div class="code-box"><div class="code-top"><span>reference output</span><span>JSON</span></div><pre>{
  "delay_ms": 20,
  "matches": [
    {
      "program_id": "11111111111111111111111111111111",
      "delay_ms": 20,
      "reason": "protected_top_level_instruction"
    }
  ]
}</pre></div></section>
    <section id="more"><div class="kicker">More docs</div><h2>Technical source of truth.</h2><div class="doc-links"><a class="doc-link" href="${GITHUB}/blob/main/docs/ARCHITECTURE.md"><b>Architecture</b><span>Runtime placement and integration boundary →</span></a><a class="doc-link" href="${GITHUB}/blob/main/docs/SECURITY.md"><b>Security</b><span>Invariants and failure model →</span></a><a class="doc-link" href="${GITHUB}/blob/main/docs/BENCHMARKING.md"><b>Benchmarking</b><span>Performance plan without fabricated numbers →</span></a><a class="doc-link" href="${GITHUB}/blob/main/docs/BAM_EARLY_ACCESS.md"><b>BAM early access</b><span>Technical integration request →</span></a></div></section>
  </article></div></section>`;
  return shellPage({ title: "Docs — XGuard ACE", description: "Run and review the public XGuard ACE policy engine and fixture-driven simulator.", active: "docs", path: "/docs", body });
}

function statusPage() {
  const body = `<section class="page-hero"><div class="shell"><div class="crumb"><a href="/">XGuard</a> / Status</div><div class="eyebrow" style="margin-top:28px">Implementation status</div><h1>Reference implementation ready. BAM production integration pending.</h1><p>This page separates completed engineering from the remaining external integration work. XGuard does not claim production BAM activation today.</p></div></section>
  <section class="section"><div class="shell"><div class="section-head"><div><div class="kicker">Current state</div><h2>What exists right now.</h2></div><p>The public repository is reviewable and the website is deployed independently on Cloudflare. The transaction-critical adapter remains intentionally unimplemented until BAM supplies the supported interface.</p></div><div class="status-grid">
    <div class="status-card done"><div class="state">Complete</div><h3>Rust policy core</h3><p>Validated deterministic classification with bounded configuration and correctness tests.</p></div>
    <div class="status-card done"><div class="state">Complete</div><h3>Reference simulator</h3><p>Fixture-driven local execution for policy and transaction views.</p></div>
    <div class="status-card done"><div class="state">Complete</div><h3>Public review surface</h3><p>Specification, architecture, security model, docs, CI, CodeQL, and Cloudflare deployment.</p></div>
    <div class="status-card pending"><div class="state">Pending BAM</div><h3>Official adapter contract</h3><p>Supported ACE/plugin SDK or integration boundary from the BAM early-access team.</p></div>
    <div class="status-card pending"><div class="state">Pending BAM</div><h3>Test / attestation environment</h3><p>BAM-specific review environment and any TEE expectations for plugin activation.</p></div>
    <div class="status-card pending"><div class="state">Pending BAM</div><h3>Production activation</h3><p>No production traffic or plugin fee claims until BAM accepts and activates the integration.</p></div>
  </div><div class="cta" style="margin-top:52px"><div class="eyebrow">Transparency</div><h2>Review the code, not a marketing promise.</h2><p>The repository contains the implementation and the exact early-access brief already prepared for BAM.</p><div class="cta-actions"><a class="btn primary" href="${GITHUB}">Open repository ${icons.arrow}</a><a class="btn secondary" href="${GITHUB}/blob/main/docs/BAM_EARLY_ACCESS.md">Read early-access brief</a></div></div></div></section>`;
  return shellPage({ title: "Status — XGuard ACE", description: "Current implementation and BAM integration status for XGuard ACE.", active: "status", path: "/status", body });
}

function notFound() {
  return shellPage({ title: "Not found — XGuard ACE", description: "The requested XGuard ACE page does not exist.", path: "/404", status: 404, body: `<section class="notfound"><div class="shell"><h1>404</h1><h2>That route is not part of XGuard.</h2><p>Return to the product overview or review the public documentation.</p><a class="btn primary" href="/">Back to XGuard</a></div></section>` });
}

function favicon() {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="18" fill="#0d121a"/><path d="M17 19 27 32 17 45" fill="none" stroke="#9ca8ff" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="m47 19-10 13 10 13" fill="none" stroke="#5fe1c8" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/><path d="M27 32h10" stroke="#f6f7fa" stroke-width="6" stroke-linecap="round"/></svg>`, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}

function ogImage() {
  return new Response(`<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630"><defs><radialGradient id="g" cx="0" cy="0" r="1" gradientTransform="translate(945 120) rotate(135) scale(520)"><stop stop-color="#7c8cff" stop-opacity=".28"/><stop offset="1" stop-color="#07090d" stop-opacity="0"/></radialGradient></defs><rect width="1200" height="630" fill="#07090d"/><rect width="1200" height="630" fill="url(#g)"/><g transform="translate(84 76)"><rect width="54" height="54" rx="15" fill="#10151e" stroke="#303744"/><path d="M14 16 23 27 14 38" fill="none" stroke="#9ca8ff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="m40 16-9 11 9 11" fill="none" stroke="#5fe1c8" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/><path d="M23 27h8" stroke="#fff" stroke-width="4" stroke-linecap="round"/></g><text x="156" y="113" font-family="Arial,Helvetica,sans-serif" font-size="28" font-weight="700" fill="#f5f7fb">XGuard ACE</text><text x="84" y="310" font-family="Arial,Helvetica,sans-serif" font-size="82" font-weight="700" letter-spacing="-4" fill="#f5f7fb">Protect quotes</text><text x="84" y="397" font-family="Arial,Helvetica,sans-serif" font-size="82" font-weight="700" letter-spacing="-4" fill="#8c96a8">before execution.</text><text x="84" y="490" font-family="Arial,Helvetica,sans-serif" font-size="25" fill="#9aa4b5">Deterministic application-level scheduling protection designed for BAM.</text><text x="84" y="553" font-family="monospace" font-size="17" fill="#65ddc6">10–50 ms guard · Pure Rust · No custody · No client install</text></svg>`, { headers: { "content-type": "image/svg+xml", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}

function robots() {
  return new Response(`User-agent: *\nAllow: /\nSitemap: ${SITE}/sitemap.xml\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}

function sitemap() {
  const pages = ["/", "/product", "/architecture", "/security", "/docs", "/status"];
  const urls = pages.map((p) => `<url><loc>${SITE}${p}</loc></url>`).join("");
  return new Response(`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls}</urlset>`, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff" } });
}

function securityTxt() {
  return new Response(`Contact: mailto:mo.elayyan2023@gmail.com\nCanonical: ${SITE}/.well-known/security.txt\nPolicy: ${SITE}/security\n`, { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=86400" } });
}

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (request.method !== "GET" && request.method !== "HEAD") return json({ error: "method_not_allowed" }, 405);
    const path = url.pathname.length > 1 && url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
    if (path === "/healthz") return json({ status: "ok", service: "XGuard ACE", mode: "bam-early-access-candidate", site_version: SITE_VERSION });
    if (path === "/spec.json") return json(SPEC);
    if (path === "/favicon.svg") return favicon();
    if (path === "/og.svg") return ogImage();
    if (path === "/robots.txt") return robots();
    if (path === "/sitemap.xml") return sitemap();
    if (path === "/.well-known/security.txt") return securityTxt();
    if (path === "/") return homePage();
    if (path === "/product") return productPage();
    if (path === "/architecture") return architecturePage();
    if (path === "/security") return securityPage();
    if (path === "/docs") return docsPage();
    if (path === "/status") return statusPage();
    return notFound();
  }
};
