export function eudrSmartEmployeeSite(request: Request): Response | null {
  const url = new URL(request.url);
  if (
    request.method !== "GET" ||
    !["/", "/eudr-operations", "/operations"].includes(url.pathname)
  )
    return null;

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard — Your Smart Cross-Border Operations Employee</title>
<meta name="description" content="XGuard is a smart cross-border operations employee for government, customs, compliance and supplier work. Starting with EUDR, XGuard prepares, follows up, organises, executes supported workflows and keeps an audit-ready record.">
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f5ef;color:#10110f;--ink:#10110f;--muted:#5c6056;--line:#d8dcd0;--lime:#dfff45;--white:#fff}*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0}.wrap{max-width:1200px;margin:auto;padding:26px}.nav{display:flex;justify-content:space-between;align-items:center;gap:18px}.logo{font-size:24px;font-weight:900;letter-spacing:-.045em}.navlinks{display:flex;gap:14px;align-items:center;flex-wrap:wrap}.navlinks a{color:var(--ink);text-decoration:none;font-size:14px;font-weight:750}.navlinks .button,.cta{background:var(--ink);color:#fff;padding:13px 18px;border-radius:999px}.hero{padding:88px 0 52px}.kicker{font-size:12px;font-weight:900;letter-spacing:.14em;text-transform:uppercase}.hero h1{font-size:clamp(48px,8.7vw,102px);line-height:.89;letter-spacing:-.07em;max-width:1120px;margin:14px 0 28px}.hero p{max-width:850px;font-size:22px;line-height:1.52;color:#40433b}.mark{background:var(--lime);padding:0 .08em}.cta{display:inline-block;text-decoration:none;font-weight:850;margin-top:8px}.bar{background:var(--ink);color:#fff;border-radius:26px;padding:32px;margin:40px 0}.bar strong{font-size:clamp(25px,3vw,34px);letter-spacing:-.035em}.bar p{margin:9px 0 0;color:#d7dacd;line-height:1.55}.section{padding:54px 0}.section h2{font-size:clamp(38px,5.4vw,67px);line-height:.95;letter-spacing:-.058em;margin:0 0 24px;max-width:980px}.section .intro{font-size:20px;line-height:1.55;max-width:850px;color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-top:26px}.card{background:var(--white);border:1px solid var(--line);border-radius:20px;padding:24px;min-height:190px}.card b{font-size:23px;display:block;letter-spacing:-.035em;margin-bottom:9px}.card p{margin:0;line-height:1.55;color:#56594f}.human{display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:26px}.human .bad,.human .good{border-radius:22px;padding:27px}.human .bad{background:#fff;border:1px solid var(--line)}.human .good{background:var(--ink);color:#fff}.human h3{font-size:29px;letter-spacing:-.04em;margin:0 0 15px}.human ul{margin:0;padding-left:20px;line-height:1.75}.human .good li{color:#e3e5dd}.flow{background:#fff;border:1px solid var(--line);border-radius:20px;padding:25px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.9;overflow:auto;white-space:pre-line}.proof{font-size:23px;line-height:1.55;border-left:5px solid var(--ink);padding-left:22px;max-width:900px}.prices{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.price{background:#fff;border:1px solid var(--line);border-radius:22px;padding:27px}.price h3{font-size:24px;margin:0 0 9px}.number{font-size:46px;font-weight:950;letter-spacing:-.055em}.price ul{padding-left:20px;line-height:1.68}.small{font-size:13px;color:#696c63;line-height:1.55}.tag{display:inline-block;background:#e7eadf;border-radius:999px;padding:7px 10px;font-size:12px;font-weight:800;margin-bottom:10px}.foot{font-size:13px;color:#696c63;line-height:1.55;padding:25px 0 55px}.legal{background:#fff;border:1px solid var(--line);border-radius:18px;padding:18px;margin-top:22px}.legal strong{display:block;margin-bottom:5px}@media(max-width:840px){.grid,.prices,.human{grid-template-columns:1fr}.navlinks a:not(.button){display:none}.hero{padding-top:54px}}
</style>
</head>
<body><main class="wrap">
<nav class="nav"><div class="logo">XGuard</div><div class="navlinks"><a href="#work">What it does</a><a href="#eudr">EUDR</a><a href="#pricing">Pricing</a><a class="button" href="mailto:info@xguardgate.com?subject=XGuard%20Operations%20Pilot">Start a pilot</a></div></nav>

<section class="hero"><div class="kicker">Your smart cross-border operations employee</div><h1>Give XGuard the <span class="mark">bureaucracy.</span><br>Keep your team on the business.</h1><p>Government portals. Customs requests. Compliance work. Supplier follow-up. Documents. Deadlines. Different countries. Different languages. XGuard turns supported cross-border requirements into an operational workflow, performs the repetitive work, records every step and returns the result or the exact exception that still needs a responsible person.</p><a class="cta" href="mailto:info@xguardgate.com?subject=Put%20XGuard%20to%20work">Put XGuard to work</a></section>

<div class="bar"><strong>Imagine an operations employee that does not get tired, forget a deadline, lose focus or wake up in a bad mood.</strong><p>Automation does not remove legal responsibility or judgment. It removes the repetitive chasing, copying, checking, reminding, routing and record-keeping that exhausts human teams and creates avoidable errors.</p></div>

<section class="section"><h2>Pay for execution, not idle capacity.</h2><p class="intro">Instead of carrying a large annual cost just to stay ready for unpredictable government, customs and compliance work, connect XGuard once and use it when work appears. For supported workflows, the commercial model is event-based: small, visible charges for completed operational work rather than another seat-based subscription.</p><div class="human"><div class="bad"><h3>Traditional operational load</h3><ul><li>Manual inbox chasing</li><li>Copying data between portals and spreadsheets</li><li>Deadlines living in people’s memory</li><li>Different quality from person to person</li><li>Capacity collapses when volume spikes</li><li>Repeated work for the same supplier or shipment</li></ul></div><div class="good"><h3>XGuard operating discipline</h3><ul><li>Same workflow every time</li><li>Deadline and exception tracking</li><li>No fatigue on repetitive work</li><li>Reusable authorised data instead of re-entry</li><li>Parallel handling of many cases</li><li>Every action leaves an audit trail</li></ul></div></div></section>

<section class="section" id="work"><h2>One employee. Several jobs for the same company.</h2><div class="grid">
<div class="card"><b>Government Runner</b><p>Turns a supported government request into requirements, tasks, documents, deadlines and a tracked execution path.</p></div>
<div class="card"><b>Customs Coordinator</b><p>Maps shipment identifiers, required references and handoffs so customs-facing work does not live across disconnected inboxes and spreadsheets.</p></div>
<div class="card"><b>Compliance Desk</b><p>Builds repeatable case files, checks completeness, preserves evidence and escalates only the parts that need a legal or responsible-person decision.</p></div>
<div class="card"><b>Supplier Chaser</b><p>Requests missing information, follows up, reminds, records responses and keeps suppliers moving without your team manually chasing every thread.</p></div>
<div class="card"><b>Multilingual Relay</b><p>Normalises operational instructions across languages while preserving the original source, terminology and evidence trail for review.</p></div>
<div class="card"><b>Deadline Engine</b><p>Tracks due dates, renewals, unresolved requests and exceptions so a task does not disappear because somebody was busy.</p></div>
<div class="card"><b>Evidence Vault</b><p>Keeps source documents, versions, hashes, handoffs and status history together so the company can reconstruct what happened later.</p></div>
<div class="card"><b>ERP / API Worker</b><p>Takes work from an ERP, API, webhook, CSV or supported inbox and returns status, reference or exception without forcing a new manual dashboard routine.</p></div>
<div class="card"><b>Readiness Autopilot</b><p>Prepares workflows before a live movement arrives. Our operating principle: 90% is readiness; the last 10% is execution.</p></div>
</div></section>

<section class="section"><h2>You give XGuard the objective. XGuard manages the operational path.</h2><div class="flow">SHIPMENT / PO / GOVERNMENT REQUEST / CUSTOMS REQUEST / COMPLIANCE TASK
→ identify the configured country + authority + workflow
→ create the case and deadline
→ reuse current authorised master data
→ identify missing facts and evidence
→ request / remind / escalate
→ prepare forms, references and supporting package
→ validate completeness and obvious inconsistencies
→ READY or EXCEPTION
→ authorised filing / handoff route where supported
→ reconcile acknowledgement / status / reference
→ return result to your ERP / team / broker
→ preserve the audit record</div></section>

<section class="section" id="eudr"><span class="tag">FIRST PRODUCTION FOCUS</span><h2>EUDR is where XGuard starts proving the model.</h2><p class="intro">XGuard’s first focused workflow is EUDR operations: supplier/reference intake, readiness, evidence organisation, geodata preflight, case assembly, status handoff and audit history. EU-system execution is activated only when the participant’s authorisation, credentials and the current production integration are valid.</p><p class="proof">The goal is not to give your EUDR team another screen. The goal is to become the worker that removes supplier chasing, repeated data entry, case preparation, status checking and reference handoff from that team.</p></section>

<section class="section"><h2>Why companies should feel the difference.</h2><div class="grid">
<div class="card"><b>Less human error</b><p>Structured validation and repeatable workflows reduce avoidable copying, omission, duplicate-entry and deadline mistakes. They do not eliminate the need for legal judgment.</p></div>
<div class="card"><b>Consistency</b><p>The hundredth case follows the same rules as the first. Volume does not make the machine impatient or careless.</p></div>
<div class="card"><b>On-time operations</b><p>Every supported case has state, owner, due date and exception status instead of being hidden inside someone’s mailbox.</p></div>
<div class="card"><b>Scale without panic hiring</b><p>High-volume repetitive work can run in parallel while humans concentrate on exceptions and decisions.</p></div>
<div class="card"><b>One fact, many uses</b><p>Current authorised supplier, product and evidence data is reused where factually and legally applicable instead of requested again.</p></div>
<div class="card"><b>Audit memory</b><p>XGuard remembers what was requested, supplied, transformed, handed off and completed so the team does not rebuild history later.</p></div>
</div></section>

<section class="section" id="pricing"><h2>Launch pricing. No seat tax.</h2><div class="prices">
<div class="price"><h3>Readiness</h3><div class="number">€0</div><p>Prepare before live operations.</p><ul><li>Readiness score</li><li>Basic EUDR supplier/reference Inbox</li><li>Workflow checklist</li><li>Evidence receipt</li></ul></div>
<div class="price"><h3>EUDR Smart Employee</h3><div class="number">€9</div><p>per completed operational case, no monthly subscription.</p><ul><li>Supplier chasing workflow</li><li>Evidence organisation</li><li>Geodata preflight</li><li>Case assembly</li><li>Audit record</li></ul></div>
<div class="price"><h3>Volume / Embedded</h3><div class="number">€4–€6</div><p>per completed EUDR case at agreed recurring volume.</p><ul><li>ERP/customs integration</li><li>White-label operational flow</li><li>Webhook/API handoff</li><li>Partner terms</li></ul></div>
</div><p class="small">These are XGuard launch prices, not market averages. Government/customs workflows outside the published supported catalog are not silently billed as if they were automated. Third-party government, customs, data-provider, payment, translation or filing fees are separate when applicable and are disclosed before use. A filing-success charge is earned only when XGuard actually produces the defined successful event.</p></section>

<section class="section"><h2>The operating rule: the task does not disappear until it is closed.</h2><p class="proof">Mood has no place in the workflow. The deadline is the deadline. The missing field stays missing until resolved. The exception stays visible until somebody makes the decision. That is the kind of boring discipline companies should not have to pay senior people to perform manually.</p></section>

<div class="legal"><strong>Important boundary</strong>XGuard is an independent software service, not a government, customs authority, competent authority, law firm or official certification body. Coverage is limited to workflows and jurisdictions that XGuard has actually configured and validated. The legally responsible company remains responsible for filings, declarations and legal decisions where the law requires it. XGuard may automate preparation, communication and authorised execution; it does not invent official approvals or fabricate legal conclusions.</div>
<p class="foot">XGuard — smart cross-border operations, starting with EUDR. Contact: info@xguardgate.com</p>
</main></body></html>`;

  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy": "default-src 'self'; style-src 'unsafe-inline'; form-action 'self' mailto:; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}
