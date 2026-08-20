type PageKey = "home" | "rights" | "governments" | "integrate" | "transparency";

const PRINCIPLES = {
  product: "XGuard Child Safety Control Layer",
  purpose:
    "Real-time protective decisions for safety events deliberately submitted by an integrated online service.",
  notFor: [
    "mass surveillance",
    "parental spyware",
    "continuous device monitoring",
    "law-enforcement interception",
    "advertising or commercial profiling of children",
    "location tracking",
    "social scoring or behavioural punishment",
  ],
  safeguards: [
    "data minimization",
    "purpose limitation",
    "no raw conversation storage in the child-safety scan ledger",
    "pseudonymous risk-session and actor hashes",
    "proportionate intervention",
    "human review for serious or ambiguous cases",
    "country-aware referral to verified reporting and support channels",
    "host-platform accountability for enforcement and user-facing due process",
  ],
  rights: [
    "safety and protection from sexual exploitation and abuse",
    "privacy",
    "freedom of expression and access to information",
    "participation and evolving autonomy",
    "non-discrimination",
    "transparency and meaningful remedy",
  ],
  rawConversationLedgerStorage: false,
  remoteThirdPartyMonitoring: false,
  remoteThirdPartyEnforcement: false,
  authorityBackdoor: false,
} as const;

export function publicChildSafetySiteResponse(
  request: Request,
): Response | null {
  const url = new URL(request.url);
  if (request.method !== "GET") return null;

  if (url.pathname === "/v1/child-safety/principles") {
    return json(PRINCIPLES);
  }

  const page = pageForPath(url.pathname);
  if (page === null) return null;
  return html(renderPage(page));
}

function pageForPath(pathname: string): PageKey | null {
  if (["/", "/child-safety", "/protect", "/safety"].includes(pathname))
    return "home";
  if (pathname === "/child-safety/rights") return "rights";
  if (pathname === "/child-safety/governments") return "governments";
  if (pathname === "/child-safety/integrate") return "integrate";
  if (pathname === "/child-safety/transparency") return "transparency";
  return null;
}

function renderPage(page: PageKey): string {
  const title: Record<PageKey, string> = {
    home: "XGuard — Child Safety without Surveillance",
    rights: "Child Rights & Privacy — XGuard",
    governments: "Government & Regulator Brief — XGuard",
    integrate: "Integrate XGuard Child Safety",
    transparency: "Transparency — XGuard Child Safety",
  };
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width,initial-scale=1" />
<meta name="color-scheme" content="dark" />
<meta name="description" content="XGuard is a rights-respecting child-safety control layer for online services. It protects children without becoming a surveillance product." />
<title>${escapeHtml(title[page])}</title>
<style>${styles()}</style>
</head>
<body>
${nav(page)}
<main>${pageBody(page)}</main>
${footer()}
</body>
</html>`;
}

function nav(page: PageKey): string {
  return `<header class="nav"><a class="brand" href="/">XGuard<span>.</span></a><nav>${navLink("home", page, "/child-safety", "Overview")}${navLink("rights", page, "/child-safety/rights", "Child rights")}${navLink("governments", page, "/child-safety/governments", "Governments")}${navLink("integrate", page, "/child-safety/integrate", "Integrate")}${navLink("transparency", page, "/child-safety/transparency", "Transparency")}</nav><a class="nav-cta" href="/child-safety/dashboard">Dashboard</a></header>`;
}

function navLink(
  key: PageKey,
  current: PageKey,
  href: string,
  label: string,
): string {
  return `<a${key === current ? ` class="active"` : ""} href="${href}">${escapeHtml(label)}</a>`;
}

function pageBody(page: PageKey): string {
  if (page === "rights") return rightsPage();
  if (page === "governments") return governmentsPage();
  if (page === "integrate") return integratePage();
  if (page === "transparency") return transparencyPage();
  return homePage();
}

function homePage(): string {
  return `<section class="hero shell">
<div class="kicker"><span class="dot"></span> Rights-respecting child-safety infrastructure</div>
<h1>Protect children.<br><em>Not monitor childhood.</em></h1>
<p class="lead">XGuard gives online services real-time decisions for grooming, sexual solicitation, sextortion, unsafe sexual content and repeated predatory contact — while drawing a hard line against mass surveillance, parental spyware and commercial profiling of children.</p>
<div class="hero-actions"><a class="button primary" href="/child-safety/integrate">Integrate protection</a><a class="button" href="/child-safety/rights">Read the rights model</a></div>
<div class="trust-row"><span>No raw conversation ledger</span><span>No location tracking</span><span>No ad profiling</span><span>No authority backdoor</span></div>
</section>
<section class="shell split statement">
<div><div class="section-label">The boundary</div><h2>XGuard is a safety control layer. It is not a surveillance system.</h2></div>
<div class="statement-copy"><p>An integrating service deliberately sends a safety event that already exists in its own product flow. XGuard evaluates that event and returns a narrow protective decision such as <b>WARN</b>, <b>BLUR</b>, <b>BLOCK</b>, <b>FREEZE CHAT</b> or <b>ESCALATE</b>.</p><p>XGuard does not open a child’s device, listen to a microphone in the background, track location, create a secret parent console, or give governments a live feed of children’s conversations.</p></div>
</section>
<section class="shell cards three">
${card("01", "Context, not blanket monitoring", "Risk can be assessed across an explicit session so grooming patterns are not reduced to one message — without turning every child into a permanent profile.")}
${card("02", "Minimum necessary data", "The child-safety scan ledger stores safety metadata and pseudonymous hashes rather than raw conversation bodies. Raw identifiers are not required for repeat-risk tracking.")}
${card("03", "Action stays accountable", "XGuard returns a control decision. The integrated service remains responsible for enforcement, user notice, escalation, human review and applicable legal duties.")}
</section>
<section class="shell flow-wrap"><div class="section-label">How it works</div><h2>Four steps. No hidden monitoring layer.</h2><div class="flow"><div><b>1</b><span>Service event</span><small>A message, image, audio, video or ad already entering the host service.</small></div><div><b>2</b><span>Safety analysis</span><small>XGuard evaluates risk for exploitation, coercion, grooming and related harms.</small></div><div><b>3</b><span>Protective decision</span><small>ALLOW, WARN, BLUR, BLOCK, FREEZE or ESCALATE.</small></div><div><b>4</b><span>Host enforcement</span><small>The integrating service applies proportionate controls and human review.</small></div></div></section>
<section class="shell rights-band"><div><div class="section-label">Child rights by design</div><h2>Safety and freedom are not opposites.</h2><p>Our design treats protection from exploitation, privacy, freedom of expression, access to information and participation as simultaneous requirements — not trade-offs to be ignored.</p></div><a class="button light" href="/child-safety/rights">See the rights principles</a></section>
<section class="shell grids two">
<div class="panel"><div class="section-label">For platforms</div><h3>Protect users without building a surveillance stack.</h3><p>Use XGuard inside the product flow you already control. Keep user-facing decisions in your own governance system and use human safety review for severe or ambiguous cases.</p><a class="text-link" href="/child-safety/integrate">Technical integration →</a></div>
<div class="panel"><div class="section-label">For governments & regulators</div><h3>Inspect the boundary instead of taking our word for it.</h3><p>We publish the design limits, storage model and enforcement boundary. We welcome regulator guidance on verified reporting channels, safeguards and jurisdiction-specific requirements.</p><a class="text-link" href="/child-safety/governments">Government brief →</a></div>
</section>`;
}

function rightsPage(): string {
  return `<section class="page-hero shell"><div class="section-label">Child rights & privacy</div><h1>Safety without erasing autonomy.</h1><p class="lead">Children have a right to protection from exploitation and abuse. They also have rights to privacy, expression, information, participation and non-discrimination. XGuard is designed around both sides of that equation.</p></section>
<section class="shell cards three">
${card("Safety", "Protection from exploitation", "Detect high-risk patterns such as grooming, sexual solicitation, coercion, sextortion and pressure to move a child into unsafe private channels.")}
${card("Privacy", "Collect less, retain less", "Do not use XGuard as a general-purpose archive of children’s communications. The scan ledger is designed around metadata and pseudonymous hashes, not raw conversation storage.")}
${card("Expression", "Do not equate disagreement with danger", "XGuard is not intended to suppress lawful speech, political expression, identity, religion, relationships or ordinary teenage conversation merely because it is sensitive.")}
${card("Autonomy", "No secret parent surveillance", "XGuard is not a parental-control product and does not provide a hidden feed for parents, schools or employers to watch a child’s private activity.")}
${card("Fairness", "No child social score", "A safety event must not become a general character score, academic score, credit signal, advertising segment or lifetime behavioural label.")}
${card("Remedy", "Serious actions need accountability", "Platforms should pair severe interventions with human review, clear policy, appropriate notice and a path to challenge mistakes where safety and law permit.")}
</section>
<section class="shell quote"><p>“Protection” should never be an excuse to build unlimited surveillance around children. XGuard’s role is narrow: identify defined safety risks in an integrated service and return proportionate controls.</p></section>
<section class="shell standards"><div><div class="section-label">Reference framework</div><h2>International child-rights principles matter here.</h2><p>Our public design principles are informed by the UN Committee on the Rights of the Child’s General Comment No. 25 on children’s rights in the digital environment, which treats safety, privacy, access to information and participation as connected obligations.</p></div><div class="ref-list"><a href="https://www.ohchr.org/en/documents/general-comments-and-recommendations/general-comment-no-25-2021-childrens-rights-relation" rel="noreferrer">UN Committee on the Rights of the Child — General Comment No. 25 ↗</a><a href="https://childhelplineinternational.org/" rel="noreferrer">Child Helpline International ↗</a><a href="https://www.weprotect.org/" rel="noreferrer">WeProtect Global Alliance ↗</a><a href="https://www.inhope.org/" rel="noreferrer">INHOPE ↗</a></div></section>`;
}

function governmentsPage(): string {
  return `<section class="page-hero shell"><div class="section-label">Government & regulator brief</div><h1>We are not a child surveillance authority.</h1><p class="lead">XGuard is independent technical infrastructure for online services. We do not investigate children, intercept communications, operate a law-enforcement feed or remotely control third-party platforms that have not integrated us.</p></section>
<section class="shell gov-grid"><div class="gov-main panel"><h2>What we are asking from public authorities</h2><ol><li><b>Validate referral routes.</b><span>Tell us the correct, official reporting and child-support channels for your jurisdiction so we do not publish unverified contacts.</span></li><li><b>Review safeguards.</b><span>Identify jurisdiction-specific privacy, child-rights, platform-safety, reporting or due-process safeguards we should reflect before deployment.</span></li><li><b>Route us to the right technical contact.</b><span>Where appropriate, connect XGuard with the national online-safety, child-protection, cybercrime or hotline team responsible for technology-enabled child protection.</span></li></ol></div><div class="panel boundary"><h3>Explicit non-goals</h3><ul><li>No mass interception.</li><li>No parental spy mode.</li><li>No hidden government access.</li><li>No location tracking.</li><li>No advertising profile of children.</li><li>No political or behavioural policing.</li><li>No remote shutdown of non-integrated services.</li></ul></div></section>
<section class="shell matrix"><div class="section-label">Responsibility boundary</div><h2>Who does what?</h2><div class="table"><div class="tr head"><span>Function</span><span>XGuard</span><span>Integrated service / authority</span></div><div class="tr"><span>Analyze submitted safety event</span><span>Yes</span><span>May also review</span></div><div class="tr"><span>Store raw child conversation in XGuard scan ledger</span><span>No</span><span>Subject to its own lawful policy</span></div><div class="tr"><span>Apply block/freeze/account action</span><span>Decision signal only</span><span>Yes</span></div><div class="tr"><span>Investigate crime</span><span>No</span><span>Authorized authority</span></div><div class="tr"><span>Make mandatory report</span><span>Not a substitute for the provider’s duty</span><span>Responsible provider / authorized party</span></div><div class="tr"><span>Provide child support</span><span>Referral routing only</span><span>Verified helpline / service</span></div></div></section>
<section class="shell outreach"><div><div class="section-label">Open technical dialogue</div><h2>We prefer verified cooperation over invented compliance claims.</h2><p>If a regulator or child-protection body identifies a better referral route, safer intervention boundary or additional child-rights safeguard, XGuard should change its implementation rather than pretend every jurisdiction is identical.</p></div><a class="button light" href="/child-safety/transparency">Review transparency details</a></section>`;
}

function integratePage(): string {
  return `<section class="page-hero shell"><div class="section-label">Technical integration</div><h1>Put XGuard inside the safety path you already control.</h1><p class="lead">The host service decides what safety events to submit. XGuard returns structured risk and enforcement guidance; the host remains responsible for product controls and user-facing governance.</p></section>
<section class="shell code-grid"><div class="panel"><h3>1. Scan a safety event</h3><pre><code>const result = await xguard.scan({
  eventId: "evt_12345678",
  riskSessionId: "session_12345678",
  contentKind: "message",
  childLikely: true,
  text: incomingMessage
});</code></pre></div><div class="panel"><h3>2. Enforce in your product</h3><pre><code>await xguard.enforce(result, {
  onBlock: blockMessage,
  onFreezeConversation: freezeChat,
  onHumanReview: openSafetyCase
});</code></pre></div></section>
<section class="shell cards three">${card("Text", "Messages & chat windows", "Use single-event analysis for immediate safety and session context when repeated behaviour matters.")}${card("Media", "Images, audio & video", "Browser helpers can sample a video file and audio automatically before sending structured media analysis to XGuard.")}${card("Patterns", "Repeat-risk actors", "Platforms may submit pseudonymous actor and target identifiers. XGuard hashes them before ledger storage to identify repeated high-risk behaviour without retaining raw account identifiers.")}</section>
<section class="shell note"><b>Important:</b> Do not expose a merchant API key in client-side browser code. Keep service credentials server-side. A child-safety control decision is not a substitute for your own legal review, reporting duties, safeguarding policy or human escalation process.</section>`;
}

function transparencyPage(): string {
  return `<section class="page-hero shell"><div class="section-label">Transparency</div><h1>The safest boundary is one people can inspect.</h1><p class="lead">This page describes the intended product boundary in plain language. It is not a claim that every deployment automatically satisfies every law or policy.</p></section>
<section class="shell matrix"><div class="section-label">Data model</div><h2>What the child-safety ledger is designed to retain</h2><div class="table"><div class="tr head"><span>Data</span><span>Ledger treatment</span><span>Purpose</span></div><div class="tr"><span>Raw message / transcript body</span><span>No</span><span>Analyzed for the event, not retained in the child-safety scan ledger</span></div><div class="tr"><span>Risk level & action</span><span>Yes</span><span>Auditability, billing and safety metrics</span></div><div class="tr"><span>Risk categories</span><span>Yes</span><span>Explain the type of detected safety concern</span></div><div class="tr"><span>Risk-session identifier</span><span>SHA-256 hash</span><span>Detect repeated danger in a bounded session</span></div><div class="tr"><span>Actor / target identifiers</span><span>Optional SHA-256 hashes</span><span>Detect repeated high-risk contact without raw identifiers</span></div><div class="tr"><span>Precise location</span><span>Not required</span><span>Not part of the core child-safety scan contract</span></div><div class="tr"><span>Advertising profile</span><span>No</span><span>Outside purpose</span></div></div></section>
<section class="shell cards three">${card("Scope", "Integrated services only", "XGuard cannot remotely watch, block or freeze a third-party service that has not integrated XGuard into its product flow.")}${card("Enforcement", "Decision layer, not police power", "XGuard supplies technical controls. It does not investigate crimes, arrest people or create a government interception channel.")}${card("Reporting", "Verified routes, not invented numbers", "Country-aware referral should use verified helplines and official reporting networks. Where a route is uncertain, the system should say so instead of fabricating a contact.")}</section>
<section class="shell principles-json"><div><div class="section-label">Machine-readable</div><h2>Public principles endpoint</h2><p>Systems, reviewers and regulators can retrieve the same core boundary in JSON.</p></div><a class="button" href="/v1/child-safety/principles">/v1/child-safety/principles</a></section>`;
}

function card(kicker: string, title: string, text: string): string {
  return `<article class="card"><div class="card-kicker">${escapeHtml(kicker)}</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(text)}</p></article>`;
}

function footer(): string {
  return `<footer><div class="shell footer-grid"><div><div class="brand">XGuard<span>.</span></div><p>Child-safety control infrastructure designed to protect children without becoming a surveillance product.</p></div><div><b>Product</b><a href="/child-safety">Overview</a><a href="/child-safety/integrate">Integrate</a><a href="/child-safety/dashboard">Dashboard</a></div><div><b>Governance</b><a href="/child-safety/rights">Child rights</a><a href="/child-safety/governments">Government brief</a><a href="/child-safety/transparency">Transparency</a></div><div><b>Contact</b><a href="mailto:info@xguardgate.com">info@xguardgate.com</a><a href="mailto:support@xguardgate.com">support@xguardgate.com</a></div></div><div class="shell fine">XGuard provides automated safety classification and control decisions to integrated services. It is not a law-enforcement agency, parental spyware service or universal monitoring system. Responsible service providers remain accountable for lawful deployment, human review, reporting obligations and user-facing due process.</div></footer>`;
}

function styles(): string {
  return `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#f4f7fb;background:#05080d;--muted:#9ba8ba;--line:#223044;--panel:#0b121c;--accent:#9cf3ca;--blue:#88aefc}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:radial-gradient(circle at 70% -10%,#173044 0,transparent 32%),radial-gradient(circle at 15% 15%,#13251d 0,transparent 28%),#05080d;min-height:100vh}.shell{width:min(1180px,calc(100% - 40px));margin-inline:auto}.nav{height:74px;padding:0 max(20px,calc((100vw - 1180px)/2));display:flex;align-items:center;gap:28px;position:sticky;top:0;z-index:20;background:rgba(5,8,13,.84);backdrop-filter:blur(18px);border-bottom:1px solid rgba(255,255,255,.07)}.brand{font-size:24px;font-weight:950;letter-spacing:-.05em;color:#fff;text-decoration:none}.brand span{color:var(--accent)}.nav nav{display:flex;gap:20px;align-items:center;flex:1}.nav nav a{color:#8997aa;text-decoration:none;font-size:13px;font-weight:700}.nav nav a:hover,.nav nav a.active{color:#fff}.nav-cta{font-size:12px;text-decoration:none;color:#07120d;background:var(--accent);padding:10px 14px;border-radius:999px;font-weight:900}.hero{padding-top:110px;padding-bottom:80px}.kicker,.section-label{text-transform:uppercase;letter-spacing:.16em;font-size:11px;font-weight:900;color:var(--accent)}.dot{display:inline-block;width:7px;height:7px;background:var(--accent);border-radius:99px;margin-right:8px;box-shadow:0 0 24px var(--accent)}h1{font-size:clamp(52px,8.5vw,110px);line-height:.89;letter-spacing:-.07em;margin:18px 0 28px;max-width:1080px}h1 em{font-style:normal;color:#7d8a9b}.page-hero{padding:94px 0 50px}.page-hero h1{font-size:clamp(52px,7vw,86px);max-width:1000px}.lead{font-size:clamp(18px,2.2vw,23px);line-height:1.55;color:#b4c0d0;max-width:900px}.hero-actions{display:flex;gap:12px;flex-wrap:wrap;margin-top:34px}.button{display:inline-flex;align-items:center;justify-content:center;text-decoration:none;border:1px solid #34455c;color:#e8eef7;padding:12px 17px;border-radius:11px;font-weight:850;font-size:13px}.button:hover{border-color:#70839c}.button.primary,.button.light{background:var(--accent);color:#07120d;border-color:var(--accent)}.trust-row{display:flex;flex-wrap:wrap;gap:9px;margin-top:46px}.trust-row span{font-size:12px;color:#a8b4c4;border:1px solid #26364a;background:#0a111b;padding:8px 10px;border-radius:999px}.split{display:grid;grid-template-columns:1fr 1fr;gap:70px;padding:72px 0;border-top:1px solid var(--line)}h2{font-size:clamp(32px,4.2vw,58px);line-height:1.02;letter-spacing:-.045em;margin:12px 0 18px}.statement-copy p,.panel p,.standards p,.outreach p{color:var(--muted);line-height:1.7;font-size:16px}.cards{display:grid;gap:14px;padding:10px 0 76px}.cards.three{grid-template-columns:repeat(3,1fr)}.card,.panel{border:1px solid var(--line);border-radius:20px;background:linear-gradient(180deg,#0c141f,#091019);padding:25px}.card-kicker{font-size:11px;color:var(--accent);font-weight:900;letter-spacing:.1em;text-transform:uppercase}.card h3,.panel h3{font-size:21px;letter-spacing:-.025em;margin:13px 0 9px}.card p{margin:0;color:#8f9eb0;line-height:1.65;font-size:14px}.flow-wrap{padding:70px 0}.flow{display:grid;grid-template-columns:repeat(4,1fr);gap:1px;border:1px solid var(--line);background:var(--line);border-radius:20px;overflow:hidden;margin-top:28px}.flow div{padding:24px;background:#081019;min-height:190px}.flow b{display:grid;place-items:center;width:31px;height:31px;border-radius:9px;background:#13231d;color:var(--accent);font-size:12px}.flow span{display:block;font-weight:900;font-size:18px;margin:28px 0 7px}.flow small{color:#8c9aab;line-height:1.55}.rights-band,.outreach{margin-top:40px;margin-bottom:70px;padding:38px;border-radius:24px;background:linear-gradient(125deg,#d7fbea,#9cf3ca);color:#07120d;display:flex;align-items:end;justify-content:space-between;gap:40px}.rights-band .section-label,.outreach .section-label{color:#176443}.rights-band p,.outreach p{color:#315648;max-width:760px}.rights-band h2,.outreach h2{max-width:800px}.grids.two{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding-bottom:80px}.text-link{color:var(--accent);text-decoration:none;font-weight:850}.quote{padding:45px 0 80px}.quote p{font-size:clamp(27px,4vw,48px);line-height:1.18;letter-spacing:-.04em;max-width:1050px;margin:0;color:#d8e2ef}.standards{display:grid;grid-template-columns:1fr 1fr;gap:60px;border-top:1px solid var(--line);padding:75px 0}.ref-list{display:flex;flex-direction:column;border-top:1px solid var(--line)}.ref-list a{color:#cbd6e4;text-decoration:none;padding:17px 0;border-bottom:1px solid var(--line)}.ref-list a:hover{color:var(--accent)}.gov-grid{display:grid;grid-template-columns:1.45fr .55fr;gap:14px;padding:20px 0 70px}.gov-main ol{padding:0;margin:20px 0 0;list-style:none;counter-reset:item}.gov-main li{counter-increment:item;display:grid;grid-template-columns:170px 1fr;gap:25px;padding:19px 0;border-top:1px solid var(--line)}.gov-main li b:before{content:"0" counter(item) "  ";color:var(--accent)}.gov-main li span,.boundary li{color:var(--muted);line-height:1.6}.boundary ul{padding-left:18px;line-height:1.9}.matrix{padding:50px 0 75px}.table{border:1px solid var(--line);border-radius:18px;overflow:hidden;margin-top:24px}.tr{display:grid;grid-template-columns:1.2fr .8fr 1.2fr;background:#09111b;border-top:1px solid var(--line)}.tr:first-child{border-top:0}.tr span{padding:15px 17px;color:#aab7c7}.tr span:first-child{color:#e5edf7;font-weight:750}.tr.head{background:#101a27}.tr.head span{color:#dce6f2;font-size:12px;text-transform:uppercase;letter-spacing:.08em}.code-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;padding:20px 0 35px}.code-grid pre{white-space:pre-wrap;overflow:auto;background:#05090f;border:1px solid #1c2a3b;border-radius:14px;padding:18px;color:#bfe8d4;line-height:1.6}.note{border:1px solid #385044;background:#0d1b16;color:#c0d9cc;padding:18px 20px;border-radius:16px;margin-bottom:80px;line-height:1.65}.principles-json{display:flex;justify-content:space-between;align-items:end;gap:30px;border-top:1px solid var(--line);padding:70px 0 90px}.principles-json p{color:var(--muted)}footer{border-top:1px solid var(--line);background:#04070b;padding:52px 0 32px}.footer-grid{display:grid;grid-template-columns:2fr 1fr 1fr 1fr;gap:40px}.footer-grid p{max-width:520px;color:#7d8b9d;line-height:1.6}.footer-grid b{display:block;margin-bottom:12px}.footer-grid a{display:block;color:#8997a8;text-decoration:none;margin:9px 0;font-size:13px}.fine{border-top:1px solid #172131;margin-top:38px;padding-top:22px;color:#667587;font-size:12px;line-height:1.65}@media(max-width:860px){.nav nav{display:none}.split,.cards.three,.grids.two,.gov-grid,.standards,.code-grid{grid-template-columns:1fr}.flow{grid-template-columns:1fr 1fr}.rights-band,.outreach,.principles-json{align-items:flex-start;flex-direction:column}.tr{grid-template-columns:1fr}.tr span{border-top:1px dashed #1f2d3e}.tr span:first-child{border-top:0}.footer-grid{grid-template-columns:1fr 1fr}.gov-main li{grid-template-columns:1fr}.hero{padding-top:75px}}@media(max-width:560px){.shell{width:min(100% - 28px,1180px)}.nav{padding:0 14px}.flow{grid-template-columns:1fr}.footer-grid{grid-template-columns:1fr}.rights-band,.outreach{padding:26px}h1{font-size:52px}}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=120",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    },
  });
}
