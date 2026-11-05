export const DESIGN_PATH = '/assets/live-v7.css';

export const DESIGN_CSS = `
:root {
  --ink:#17251f; --muted:#52635b; --paper:#f8f7f1; --surface:#fffefa;
  --line:#dce2d8; --green:#245743; --forest:#102821; --lime:#d8ef9e;
  --mono:ui-monospace,SFMono-Regular,Consolas,monospace;
  color:var(--ink); background:var(--paper);
}
:focus-visible { outline:2px solid #4d8065; outline-offset:4px }
.skip-link { position:absolute; top:10px; left:12px; z-index:2; transform:translateY(-150%); padding:12px 16px; background:var(--surface) }
.skip-link:focus { transform:none }
.wrap,.site-nav,.site-footer-inner { width:min(100%,1280px); padding-inline:clamp(20px,4vw,56px); margin-inline:auto }
.site-header { background:var(--forest); border-color:#30443b; color:#f6f8ef }
.site-nav { display:grid; grid-template-columns:1fr auto 1fr; align-items:center; min-height:74px; gap:28px; padding-block:12px }
.brand { display:inline-flex; align-items:center; gap:9px; width:max-content; color:inherit; font-size:21px; font-weight:730; letter-spacing:-.8px }
.brand svg { width:30px; height:30px; flex:none; color:var(--lime) }
.brand .brand-live { color:var(--lime); background:none; margin:1px 0 0 1px; padding:0; font:650 9px var(--mono); letter-spacing:.12em }
.site-nav .brand:hover { color:#fff }
.site-nav .links { justify-content:center; gap:clamp(16px,2.1vw,32px) }
.site-nav .links a { display:inline-flex; align-items:center; min-height:44px; color:#bdc9c0; font-size:13px; font-weight:550 }
.site-nav .links a:hover,.site-nav .links a[aria-current="page"] { color:var(--lime) }
.site-nav .nav-cta { justify-self:end; min-height:42px; padding:0 14px; color:#f4f8ec; border:1px solid #526559; border-radius:6px; white-space:nowrap }
.site-nav .nav-cta:hover,.site-nav .nav-cta[aria-current="page"] { border-color:var(--lime); color:var(--lime) }
.site-header :focus-visible,.home-hero :focus-visible,.site-footer :focus-visible { outline-color:var(--lime) }
.wrap { padding-block:clamp(32px,5vw,70px); min-width:0 }
.home-wrap { width:100%; max-width:none; padding:0 }
h1,h2 { color:var(--ink); text-wrap:balance }
h1 { font-family:Georgia,serif; font-weight:400; line-height:1.02; letter-spacing:-.048em; margin-bottom:22px; overflow-wrap:anywhere }
h2 { font-size:clamp(23px,3vw,34px); letter-spacing:-.04em }
h3 { line-height:1.35 }
.eyebrow { font-family:var(--mono); font-size:11px; line-height:1.5; letter-spacing:.13em }
.wrap > .eyebrow:first-child { margin-top:0 }
.breadcrumbs { margin-top:0 }
.lead { font-size:clamp(16px,2vw,19px); line-height:1.65 }
.card,.table-scroll,.forms form,.empty,.stats,.topics a,input,textarea,select { background:var(--surface); border-color:var(--line) }
.card { padding:clamp(18px,2.3vw,28px); border-radius:12px }
.card .eyebrow { margin-top:0 }
.card a:hover { text-decoration:underline }
.button,button { font:650 14px/1.2 system-ui,sans-serif; border-radius:6px; padding:12px 16px; min-height:44px }
a.button { display:inline-flex; align-items:center; gap:10px; justify-content:center; text-decoration:none }
.button svg,.text-link svg,.search svg { width:17px; height:17px; flex:none }
.text-link { display:inline-flex; align-items:center; gap:8px; font-size:14px; font-weight:650; text-decoration:none }
.text-link:hover { text-decoration:underline }
.search { width:100%; max-width:590px; margin:22px 0 26px; gap:8px }
.search input { min-width:0; min-height:49px; border-color:#b1bfb5; border-radius:6px }
.search button { display:inline-flex; align-items:center; justify-content:center; gap:8px }
.topics a { display:inline-flex; align-items:center; gap:8px; min-height:42px; padding:8px 14px; border-radius:6px; font-weight:550 }
.topics a:hover,.topics a[aria-current="page"] { border-color:#839d8d; background:#eaf0e4 }
.topics a svg { width:14px; height:14px; flex:none }
.table-scroll { border-radius:9px }
.table-scroll:focus-visible { outline-offset:3px }
th { background:#eff2ea }
td,th { overflow-wrap:anywhere }
td:first-child { min-width:145px }
td a { font-weight:550 }
.formats { align-items:center; flex-wrap:wrap; gap:10px }
.formats a { padding:7px 10px; border:1px solid var(--line); border-radius:5px; text-decoration:none }
.formats a:hover { border-color:#839d8d }
.prose .button { margin-block:4px }
.prose a,.prose code,.card .sub { overflow-wrap:anywhere }
.site-footer { width:100%; max-width:none; margin:0; padding:0; display:block; background:var(--forest); color:#b7c8bd; border:0 }
.site-footer-inner { display:grid; grid-template-columns:minmax(180px,1.45fr) repeat(3,minmax(0,1fr)); gap:28px; padding-block:46px; font-size:13px; line-height:1.6 }
.site-footer-inner p { max-width:230px; margin:12px 0 0 }
.site-footer .brand { color:#f4f8ee }
.site-footer-inner section { min-width:0; display:grid; align-content:start; justify-items:start; gap:8px }
.site-footer-inner h2 { margin:0 0 4px; color:#f4f8ee; font:650 13px/1.5 system-ui,sans-serif }
.site-footer-inner section a { color:inherit; text-decoration:none }
.site-footer-inner section a:hover { color:var(--lime); text-decoration:underline }

.home-hero { background:var(--forest); color:#eef5e9 }
.hero-inner { min-height:540px; display:grid; grid-template-columns:1.08fr 1fr; align-items:center; gap:clamp(26px,4.5vw,75px); padding-block:clamp(54px,7vw,92px) }
.hero-copy { min-width:0 }
.hero-copy .eyebrow { margin:0 0 24px; color:var(--lime); display:flex; align-items:center; gap:9px }
.hero-copy .eyebrow::before { content:""; width:7px; height:7px; border-radius:50%; background:var(--lime) }
.hero-copy h1 { color:#f7faef; font-size:clamp(46px,4.7vw,71px); line-height:.99; margin-bottom:23px; text-wrap:initial }
.hero-copy h1 em { color:var(--lime); font-weight:400 }
.hero-copy .lead { color:#c6d4c8; max-width:465px; margin:0 }
.hero-copy .search { margin:26px 0 12px }
.hero-copy .search input { color:var(--ink); background:#f8faf2; border-color:#f8faf2 }
.hero-copy .search input::placeholder { color:#56675e }
.hero-copy .search button { background:var(--lime); color:#1b3427 }
.hero-copy .search button:hover { background:#e7f7c0 }
.hero-examples { display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; color:#b3c5b9; font-size:12px }
.hero-examples a { color:#dce9d9; font:12px var(--mono); text-decoration:none; padding-block:6px }
.hero-examples a:hover { color:var(--lime); text-decoration:underline }
.hero-figure { position:relative; isolation:isolate; min-width:0; min-height:375px; display:flex; align-items:end; padding:21px; margin:0; overflow:hidden; border:1px solid #415b4d; border-radius:14px; background:radial-gradient(ellipse at 58% 32%,#29493a,#152f27 68%) }
.hero-figure::before { content:""; position:absolute; inset:0; z-index:-1; background:linear-gradient(#d7e9d511 1px,transparent 1px),linear-gradient(90deg,#d7e9d511 1px,transparent 1px); background-size:31px 31px; mask-image:linear-gradient(#000,#000 75%,transparent) }
.figure-caption { position:absolute; top:20px; left:21px; right:21px; display:flex; justify-content:space-between; gap:10px; color:#c3d0bf; font:10px/1.5 var(--mono); letter-spacing:.11em; text-transform:uppercase }
.figure-caption span:last-child { color:#e0efbe }
.figure-art { position:absolute; z-index:-1; top:40px; left:2%; width:96%; height:70%; color:#c3e29c }
.hero-sample { position:relative; display:grid; grid-template-columns:minmax(0,1fr) auto; gap:10px 16px; width:100%; padding:16px 17px; border:1px solid #527161; border-radius:9px; background:#102820; color:#f6faf1; text-decoration:none }
a.hero-sample:hover { border-color:var(--lime); color:#fff }
.sample-label { min-width:0; align-self:center; color:#e5eee2; font-size:13px; overflow-wrap:anywhere }
.sample-value { display:block; color:var(--lime); font:550 clamp(19px,2.9vw,29px)/1.1 var(--mono); overflow-wrap:anywhere }
.sample-meta { grid-column:1/-1; color:#b9ccbd; font:11px/1.5 var(--mono); overflow-wrap:anywhere }
.hero-sample .tag { align-self:start; justify-self:end }
.hero-sample .tag.verified { background:#304b37; color:#e0f3b4 }
.hero-sample-empty { grid-template-columns:1fr }
.home-stats { border-bottom:1px solid var(--line); background:#f0f1e8 }
.home-stats .stats { background:none; border:0; border-radius:0; margin:0 auto; padding-block:0 }
.home-stats .stat { padding:20px 22px 22px }
.home-stats .stat:first-child { padding-left:0 }
.home-stats .stat strong { color:var(--green); font-size:clamp(24px,3.5vw,40px); line-height:1.1; font-variant-numeric:tabular-nums }
.home-stats .stat span { font-size:13px }
.home-content { padding-block:clamp(38px,6vw,76px) }
.home-section + .home-section { margin-top:clamp(42px,6vw,72px) }
.home-section .section-head { margin-bottom:20px; align-items:end }
.home-section h2,.connect-panel h2 { font:400 clamp(30px,4.3vw,49px)/1.05 Georgia,serif; letter-spacing:-.045em; margin:0 }
.home-section .eyebrow,.connect-panel .eyebrow { margin:0 0 9px }
.home-section .section-head .text-link { flex-shrink:0; padding-bottom:3px }
.fact-preview { display:flex; flex-direction:column; min-width:0; gap:12px }
.fact-preview h3 { margin:0; overflow-wrap:anywhere }
.fact-preview h3 a { color:var(--ink) }
.fact-preview .value { margin:auto 0 0; color:var(--green); font-size:clamp(17px,2.4vw,26px) }
.fact-preview .sub { margin:0 }
.fact-preview .tag { align-self:start }
.home-section .topics { margin-bottom:0 }
.connect-panel { display:flex; align-items:center; justify-content:space-between; gap:24px; padding:clamp(23px,4vw,45px); background:#e8eee1; border:1px solid #d4decf; border-radius:12px }
.connect-panel p:not(.eyebrow) { margin:12px 0 0; color:var(--muted); line-height:1.6 }
.connect-panel .actions { display:flex; flex-wrap:wrap; align-items:center; gap:10px 18px }
.connect-panel .text-link { min-height:44px }
.home-meta { margin-top:0; margin-bottom:34px; padding-block:0 }
@media (max-width:900px) {
  .site-nav { gap:16px }
  .hero-inner { min-height:0; gap:24px }
  .hero-figure { min-height:340px }
  .figure-caption { font-size:9px }
  .site-nav .links { gap:15px }
  .site-nav .links a { font-size:12px }
}
@media (max-width:720px) {
  .site-nav { grid-template-columns:minmax(0,1fr) auto; padding-block:12px 4px; gap:4px 12px }
  .site-nav .links { grid-row:2; grid-column:1/-1; justify-content:flex-start; gap:0 14px }
  .site-nav .nav-cta { grid-row:1; grid-column:2 }
  .hero-inner { grid-template-columns:1fr; padding-block:46px 30px; gap:27px }
  .hero-copy h1 { font-size:clamp(47px,9.3vw,68px) }
  .hero-copy .eyebrow { margin-bottom:18px }
  .hero-figure { min-height:300px }
  .home-stats .stat { padding:15px 14px }
  .home-stats .stat:nth-child(odd) { padding-left:0 }
  .home-stats .stat:nth-child(n+3) { border-bottom:0 }
  .site-footer-inner { grid-template-columns:repeat(2,minmax(0,1fr)); padding-block:33px }
  .connect-panel { align-items:flex-start; flex-direction:column }
}
@media (max-width:520px) {
  .site-nav .brand { font-size:18px; gap:6px }
  .site-nav .brand svg { width:26px; height:26px }
  .site-nav .nav-cta { font-size:12px; padding-inline:9px }
  .search { flex-direction:row }
  .hero-figure { min-height:278px; padding:13px }
  .figure-caption { inset-inline:14px; top:15px }
  .hero-sample { padding:12px }
  .hero-copy .search input { padding-inline:9px; font-size:14px }
  .search button { padding-inline:10px }
  .search button svg { display:none }
  .home-section .section-head { flex-wrap:wrap; gap:12px }
  .site-footer-inner { gap:24px 16px }
}
@media (max-width:380px) {
  .site-nav .nav-cta svg { display:none }
}
`;
