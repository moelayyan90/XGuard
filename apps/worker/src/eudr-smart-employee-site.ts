export function eudrSmartEmployeeSite(request: Request): Response | null {
  const url = new URL(request.url);
  if (request.method !== "GET" || (url.pathname !== "/" && url.pathname !== "/eudr-operations")) return null;

  const body = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard — Your EUDR Smart Employee</title>
<meta name="description" content="XGuard runs repetitive EUDR operations for your team: supplier chasing, readiness, evidence organisation, case preparation, execution handoff and audit records.">
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f3f5ef;color:#10110f}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1180px;margin:auto;padding:26px}.nav{display:flex;justify-content:space-between;align-items:center}.logo{font-size:24px;font-weight:850;letter-spacing:-.04em}.nav a,.cta{background:#10110f;color:#fff;text-decoration:none;padding:13px 18px;border-radius:999px;font-weight:800}.hero{padding:82px 0 48px}.kicker{font-size:12px;font-weight:850;letter-spacing:.12em;text-transform:uppercase}.hero h1{font-size:clamp(48px,8.5vw,100px);line-height:.9;letter-spacing:-.068em;max-width:1080px;margin:14px 0 26px}.hero p{max-width:820px;font-size:22px;line-height:1.5;color:#40433b}.mark{background:#dfff45;padding:0 .07em}.bar{background:#10110f;color:#fff;border-radius:24px;padding:30px;margin:36px 0}.bar strong{font-size:28px}.section{padding:50px 0}.section h2{font-size:clamp(38px,5vw,64px);line-height:.96;letter-spacing:-.055em;margin:0 0 24px}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.card{background:#fff;border:1px solid #d8dcd0;border-radius:18px;padding:23px;min-height:185px}.card b{font-size:23px;display:block;letter-spacing:-.035em;margin-bottom:9px}.card p{margin:0;line-height:1.5;color:#56594f}.flow{background:#fff;border:1px solid #d8dcd0;border-radius:18px;padding:24px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;line-height:1.85;overflow:auto}.prices{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}.price{background:#fff;border:1px solid #d8dcd0;border-radius:20px;padding:26px}.price h3{font-size:24px;margin:0 0 10px}.number{font-size:44px;font-weight:900;letter-spacing:-.05em}.small{font-size:13px;color:#696c63;line-height:1.5}.price ul{padding-left:20px;line-height:1.65}.proof{font-size:22px;line-height:1.5;border-left:5px solid #10110f;padding-left:20px}.foot{font-size:13px;color:#696c63;line-height:1.5;padding:25px 0 55px}@media(max-width:820px){.grid,.prices{grid-template-columns:1fr}.hero{padding-top:50px}}
</style>
</head>
<body><main class="wrap">
<nav class="nav"><div class="logo">XGuard / EUDR Operations</div><a href="mailto:info@xguardgate.com?subject=EUDR%20Operations%20Pilot">Start a pilot</a></nav>
<section class="hero"><div class="kicker">Not another dashboard. An operating employee.</div><h1>Your <span class="mark">EUDR smart employee</span> works before the shipment does.</h1><p>Send XGuard a shipment, PO, supplier list or connected ERP event. XGuard turns it into work: collect missing supplier data, organise evidence, preflight geodata, prepare the due-diligence case, keep an audit trail and hand the case to the authorised execution path. Your team handles the exceptions—not the repetitive work.</p><a class="cta" href="mailto:info@xguardgate.com?subject=Make%20XGuard%20our%20EUDR%20employee">Make XGuard our EUDR employee</a></section>
<div class="bar"><strong>90% is readiness. The final 10% is live execution.</strong><br>Prepare suppliers, product data, evidence, geolocation, credentials and process before the shipment becomes urgent.</div>
<section class="section"><h2>Give it work, not clicks.</h2><div class="grid">
<div class="card"><b>Supplier follow-up</b><p>Requests the right data, reminds the supplier, tracks missing fields and records every response.</p></div>
<div class="card"><b>Evidence organiser</b><p>Builds a reusable, versioned evidence package instead of asking for the same documents again and again.</p></div>
<div class="card"><b>Geodata preflight</b><p>Checks obvious geometry, coordinate and completeness problems before regulatory execution.</p></div>
<div class="card"><b>Case builder</b><p>Combines supplier, product, origin, shipment, evidence and risk inputs into one operational case.</p></div>
<div class="card"><b>Execution coordinator</b><p>Maps a ready case to the current EU submission workflow once production integration and authority are valid.</p></div>
<div class="card"><b>Audit memory</b><p>Keeps the timeline, evidence hashes, status, handoffs and changes so the company does not reconstruct history later.</p></div>
</div></section>
<section class="section"><h2>The job description.</h2><div class="flow">NEW SHIPMENT / PO / ERP EVENT
→ identify relevant EUDR workflow
→ open case
→ reuse valid master data
→ ask supplier only for missing inputs
→ remind / escalate automatically
→ preflight evidence + geodata
→ assemble case
→ READY or EXCEPTION
→ authorised execution path
→ reconcile status / reference
→ return result to ERP / customs / buyer
→ preserve audit record
→ include in annual due-diligence review pack</div></section>
<section class="section"><h2>Why a company keeps XGuard.</h2><p class="proof">The system becomes useful before, during and after every shipment. It reduces supplier chasing, repeated data entry, filing preparation, status checking, reference handoff and audit reconstruction from the same connected data.</p></section>
<section class="section"><h2>Launch pricing.</h2><div class="prices">
<div class="price"><h3>Readiness</h3><div class="number">€0</div><p>Prepare before live operations.</p><ul><li>Readiness score</li><li>Basic supplier/reference Inbox</li><li>Workflow checklist</li><li>Evidence receipt</li></ul></div>
<div class="price"><h3>Smart Employee</h3><div class="number">€9</div><p>per completed operational case, no subscription.</p><ul><li>Supplier chasing workflow</li><li>Evidence organisation</li><li>Geodata preflight</li><li>Case assembly</li><li>Audit record</li></ul></div>
<div class="price"><h3>Volume / Embedded</h3><div class="number">€4–€6</div><p>per completed case at agreed volume.</p><ul><li>ERP/customs integration</li><li>White-label workflow</li><li>Webhook/API handoff</li><li>Partner commercial terms</li></ul></div>
</div><p class="small">Launch prices are XGuard commercial prices, not market averages. EU-system submission is charged only once the relevant production integration and participant authorisation are operational and the promised execution event has actually succeeded. Taxes and bespoke third-party data costs, if any, are separate and disclosed before use.</p></section>
<section class="section"><h2>One rule: never enter the same fact twice.</h2><p class="proof">If XGuard already has a current, authorised and factually applicable supplier/product/evidence record, the workflow should reuse it. If it is stale, changed or uncertain, XGuard asks again. The moat is less repetitive work—not more screens.</p></section>
<p class="foot">XGuard is an independent software service. It is not an EU institution, customs authority, competent authority or legal certification body. The legally responsible operator/trader retains its regulatory responsibility. XGuard can automate preparation and operational execution, but it does not fabricate legal conclusions or replace decisions that law or company policy requires a responsible person to make.</p>
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
