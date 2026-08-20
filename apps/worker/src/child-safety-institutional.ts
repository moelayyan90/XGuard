const GLOBAL_PARTNERS = [
  {
    name: "Child Helpline International",
    role: "Global child-helpline network and country routing",
    url: "https://childhelplineinternational.org/helplines/",
  },
  {
    name: "INHOPE",
    role: "Global network of hotlines for reporting child sexual abuse material",
    url: "https://www.inhope.org/",
  },
  {
    name: "NCMEC CyberTipline",
    role: "Reporting route for suspected online child sexual exploitation",
    url: "https://report.cybertip.org/",
  },
  {
    name: "WeProtect Global Alliance",
    role: "International alliance focused on online child sexual exploitation and abuse",
    url: "https://www.weprotect.org/",
  },
  {
    name: "Ofcom",
    role: "UK online-safety regulator",
    url: "https://www.ofcom.org.uk/online-safety/",
  },
  {
    name: "European Commission — Digital Services Act",
    role: "EU online-safety and protection-of-minors policy framework",
    url: "https://digital-strategy.ec.europa.eu/en/policies/digital-services-act-package",
  },
] as const;

const PRICING = [
  { event: "message", usd: "0.005" },
  { event: "chat_window", usd: "0.010" },
  { event: "ad_text", usd: "0.010" },
  { event: "image", usd: "0.015" },
  { event: "audio", usd: "0.015" },
  { event: "video", usd: "0.020" },
] as const;

export function childSafetyInstitutionalResponse(
  request: Request,
): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);

  if (["/", "/child-safety"].includes(url.pathname)) {
    return html(page("Child Safety Infrastructure", homeBody()));
  }

  if (url.pathname === "/v1/child-safety/institutional") {
    return json({
      product: "XGuard Child Safety Control Layer",
      positioning: "Protect children without monitoring childhood",
      commercialModel: "B2B/B2G usage-based child-safety infrastructure",
      pricing: PRICING,
      partners: GLOBAL_PARTNERS,
      governmentPilot: {
        purpose:
          "Validate reporting routes, rights safeguards, intervention thresholds and technical integration without creating a surveillance feed.",
        defaultScope:
          "Limited pilot using defined safety events submitted by an integrated service; no continuous device monitoring, location tracking or hidden access.",
      },
    });
  }

  if (url.pathname === "/child-safety/compliance") {
    return html(page("Compliance & Regulation", complianceBody()));
  }
  if (url.pathname === "/child-safety/pilot") {
    return html(page("Government & Platform Pilot", pilotBody()));
  }
  if (url.pathname === "/child-safety/pricing") {
    return html(page("Commercial Pricing", pricingBody()));
  }
  if (url.pathname === "/child-safety/reporting") {
    return html(page("Global Reporting & Support", reportingBody()));
  }

  return null;
}

function homeBody(): string {
  return `${hero(
    "Child-safety infrastructure",
    "Protect children. Not monitor childhood.",
    "XGuard is paid safety infrastructure for platforms, institutions and public-sector programmes. It analyzes defined safety events already entering a host service and returns proportionate controls without becoming a child-surveillance system.",
  )}
  <section class="grid">
    ${card("For platforms", "Scan messages, chat windows, images, audio, video and ads. Apply ALLOW, WARN, BLUR, BLOCK, FREEZE CHAT or ESCALATE inside the service you already control.")}
    ${card("For governments & regulators", "Run limited pilots, validate reporting routes and inspect safeguards without receiving a hidden feed of children’s private activity.")}
    ${card("Commercial model", "Usage-based B2B/B2G pricing. Children are not the buyer; online services and institutions pay for analyzed safety events.")}
    ${card("Global reporting", "Prefer locally verified child-protection routes, with established international networks as a fallback when a direct country number is not yet validated.")}
  </section>
  <section class="steps">
    ${step("01", "Integrate", "Submit a defined safety event already entering your product flow.")}
    ${step("02", "Assess", "XGuard evaluates grooming, solicitation, coercion, sextortion, explicit media, predatory contact and sexualized advertising.")}
    ${step("03", "Control", "Receive a proportionate action and structured enforcement guidance.")}
    ${step("04", "Review", "High and critical cases are surfaced for accountable human review and verified reporting routes.")}
  </section>
  <section class="grid links">
    <a class="partner" href="/child-safety/compliance"><strong>Compliance</strong><span>Risk assessment, safeguards and regulatory positioning →</span></a>
    <a class="partner" href="/child-safety/pilot"><strong>Government / platform pilot</strong><span>A limited, measurable deployment without surveillance →</span></a>
    <a class="partner" href="/child-safety/pricing"><strong>Pricing</strong><span>Usage-based commercial API pricing →</span></a>
    <a class="partner" href="/child-safety/reporting"><strong>Global reporting</strong><span>Verified support and reporting networks →</span></a>
  </section>
  <section class="cta"><h2>Start an institutional conversation</h2><p>Partnerships, regulators and government pilots: <a href="mailto:info@xguardgate.com">info@xguardgate.com</a><br>Technical support: <a href="mailto:support@xguardgate.com">support@xguardgate.com</a></p></section>`;
}

function complianceBody(): string {
  return `${hero(
    "Compliance & regulation",
    "Build protection controls that can be inspected, documented and challenged.",
    "XGuard is designed as a narrow safety-control layer for services that already handle user content. It is not a general monitoring system and does not create a government or parent surveillance feed.",
  )}
  <section class="grid">
    ${card("Risk assessment support", "Provide structured evidence about what was scanned, which risk category was detected, confidence, action taken and whether human review was required.")}
    ${card("Protection of minors", "Support product controls for grooming, sexual solicitation, sextortion, explicit sexual content, predatory contact and sexualized advertising.")}
    ${card("Data minimization", "Use pseudonymous session and actor hashes for repeat-risk analysis and keep raw conversation bodies out of the child-safety scan ledger.")}
    ${card("Human accountability", "High and critical interventions are designed to surface human review rather than silently turning an automated decision into permanent punishment.")}
  </section>
  <section class="panel"><h2>Regulatory positioning</h2><p>XGuard should be used as one technical control inside a broader safeguarding and compliance programme. The integrating organization remains responsible for its legal duties, notices, reporting obligations, human escalation and appeals.</p><p>Our product boundary is intentionally compatible with rights-based online-safety approaches: proportionality, privacy, child protection, transparency and meaningful remedy.</p></section>`;
}

function pilotBody(): string {
  return `${hero(
    "Government & platform pilot",
    "Prove the safety value without building a surveillance programme.",
    "A pilot can test real child-safety workflows on defined events while preserving a hard technical boundary against device monitoring, location tracking and hidden institutional access.",
  )}
  <section class="steps">
    ${step("1", "Define the safety scope", "Agree which harms and content flows are in scope: grooming, coercion, sexual solicitation, explicit media, dangerous repeat contact and sexualized ads.")}
    ${step("2", "Validate local referral routes", "Confirm the correct child helpline, police/cybercrime route, hotline and emergency path for the jurisdiction.")}
    ${step("3", "Run a limited integration", "The host submits only defined safety events already in its product flow. XGuard returns structured risk and enforcement guidance.")}
    ${step("4", "Measure outcomes", "Track blocked high-risk content, frozen conversations, repeat-risk actors, false positives, human-review outcomes and reporting-route accuracy.")}
    ${step("5", "Publish safeguards", "Document retention, review, appeals, reporting and child-rights controls before broader rollout.")}
  </section>
  <section class="panel"><h2>What a pilot does not include</h2><ul><li>No background microphone or camera monitoring.</li><li>No child location tracking.</li><li>No secret parent or government dashboard of private activity.</li><li>No general behavioural scoring.</li><li>No remote control over third-party services that have not integrated XGuard.</li></ul></section>
  <section class="cta"><h2>Institutional contact</h2><p>Government, regulator and public-sector enquiries: <a href="mailto:info@xguardgate.com">info@xguardgate.com</a></p></section>`;
}

function pricingBody(): string {
  const rows = PRICING.map(
    (p) =>
      `<tr><td>${esc(p.event)}</td><td>$${esc(p.usd)}</td><td>per analyzed safety event</td></tr>`,
  ).join("");
  return `${hero(
    "Commercial pricing",
    "Usage-based infrastructure, priced for large-volume services.",
    "XGuard is a paid B2B/B2G safety layer. The end child is not the buyer; platforms, institutions and programmes pay for analyzed safety events.",
  )}
  <section class="panel"><table><thead><tr><th>Event</th><th>Base price</th><th>Billing unit</th></tr></thead><tbody>${rows}</tbody></table><p class="note">Enterprise volume agreements, government pilots and dedicated support can be contracted separately. Prices shown are base API list prices and do not represent legal or human-review fees.</p></section>`;
}

function reportingBody(): string {
  const items = GLOBAL_PARTNERS.map(
    (p) =>
      `<a class="partner" href="${p.url}" rel="noreferrer"><strong>${esc(p.name)}</strong><span>${esc(p.role)}</span></a>`,
  ).join("");
  return `${hero(
    "Global reporting & support",
    "Never invent a hotline number.",
    "XGuard prefers a verified country-specific route. When one has not yet been validated, the product falls back to established international networks and official country selectors.",
  )}<section class="partners">${items}</section><section class="panel"><h2>Emergency boundary</h2><p>If a child is in immediate physical danger, users must contact the local emergency service or police for the child’s current location. XGuard is a technology provider, not an emergency-response authority.</p></section>`;
}

function page(title: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="XGuard child-safety infrastructure for platforms, governments and institutions — protection without surveillance."><title>${esc(title)} — XGuard</title><style>${styles()}</style></head><body><header><a class="brand" href="/child-safety">XGuard.</a><nav><a href="/child-safety">Overview</a><a href="/child-safety/compliance">Compliance</a><a href="/child-safety/pilot">Pilot</a><a href="/child-safety/pricing">Pricing</a><a href="/child-safety/reporting">Reporting</a><a href="/child-safety/rights">Rights</a><a href="/child-safety/integrate">Integrate</a></nav></header><main>${body}</main><footer><span>Protect children. Not monitor childhood.</span><span>info@xguardgate.com · support@xguardgate.com</span></footer></body></html>`;
}

function hero(label: string, title: string, text: string): string {
  return `<section class="hero"><div class="eyebrow">${esc(label)}</div><h1>${esc(title)}</h1><p>${esc(text)}</p></section>`;
}

function card(title: string, text: string): string {
  return `<article class="card"><h3>${esc(title)}</h3><p>${esc(text)}</p></article>`;
}

function step(n: string, title: string, text: string): string {
  return `<article class="step"><b>${esc(n)}</b><div><h3>${esc(title)}</h3><p>${esc(text)}</p></div></article>`;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

function html(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (ch) => {
    if (ch === "&") return "&amp;";
    if (ch === "<") return "&lt;";
    if (ch === ">") return "&gt;";
    return "&quot;";
  });
}

function styles(): string {
  return `*{box-sizing:border-box}body{margin:0;background:#080a0e;color:#f7f8fb;font-family:Inter,Arial,sans-serif}header,footer{max-width:1180px;margin:auto;padding:24px 28px;display:flex;justify-content:space-between;gap:24px;align-items:center}.brand{font-size:24px;font-weight:800;color:#fff;text-decoration:none}nav{display:flex;gap:16px;flex-wrap:wrap}nav a,footer{color:#aeb3bd;text-decoration:none}nav a:hover{color:#fff}main{max-width:1180px;margin:auto;padding:36px 28px 80px}.hero{padding:72px 0 52px;max-width:930px}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:#77a8ff;font-size:12px;font-weight:700}.hero h1{font-size:clamp(42px,7vw,88px);line-height:.96;margin:14px 0 24px;letter-spacing:-.035em}.hero p,.card p,.panel p,.step p{color:#b9bec7;font-size:18px;line-height:1.7}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px;margin-top:18px}.card,.panel,.step,.partner{background:linear-gradient(180deg,#12151b,#0e1116);border:1px solid #252b36;border-radius:18px;padding:26px}.card h3,.partner strong{font-size:21px}.panel{margin-top:24px}.steps{display:grid;gap:14px;margin-top:24px}.step{display:flex;gap:20px}.step>b{font-size:28px;color:#77a8ff}.partners{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.partner{display:flex;flex-direction:column;gap:8px;text-decoration:none;color:#fff}.partner:hover{border-color:#557fc4}.partner span{color:#aeb3bd;line-height:1.5}.links{margin-top:28px}.cta{margin-top:28px;padding:32px;border-radius:18px;background:#e8f1ff;color:#10141b}.cta a{color:#0b57d0}table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:16px;border-bottom:1px solid #2b2f38}th{color:#8eb4ff}.note{font-size:14px!important}ul{color:#b9bec7;line-height:1.9}footer{border-top:1px solid #20242c;font-size:14px}@media(max-width:760px){header,footer{align-items:flex-start;flex-direction:column}.grid,.partners{grid-template-columns:1fr}.hero{padding-top:34px}.hero h1{font-size:44px}main{padding-left:20px;padding-right:20px}}`;
}
