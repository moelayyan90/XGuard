const VERIFIED_AT = "2026-08-20";
const CHI_DIRECTORY = "https://childhelplineinternational.org/helplines/";
const INHOPE_DIRECTORY = "https://www.inhope.org/";
const INHOPE_REPORTING = "https://www.inhope.org/what-we-do/how-to-report";
const NCMEC_CYBERTIPLINE = "https://report.cybertip.org/";

type LocalRoute = {
  countryCode: string;
  country: string;
  organization: string;
  channel: "phone" | "directory";
  value: string;
  scope?: string;
  purpose: "child_support";
  source: string;
  verifiedAt: string;
};

const LOCAL_ROUTES: LocalRoute[] = [
  route("DZ", "Algeria", "Je t’écoute", "phone", "3033"),
  route("EG", "Egypt", "Child Helpline Egypt", "directory", CHI_DIRECTORY),
  route("IQ", "Iraq", "116 Child Helpline", "phone", "116", "Kurdistan Region"),
  route("JO", "Jordan", "JRF 110 Helpline", "phone", "110"),
  route("KW", "Kuwait", "Help Hotline", "phone", "147"),
  route(
    "LB",
    "Lebanon",
    "Child Helpline International member services",
    "directory",
    CHI_DIRECTORY,
  ),
  route(
    "MA",
    "Morocco",
    "Espace Maroc Cyberconfiance (EMC)",
    "directory",
    CHI_DIRECTORY,
  ),
  route("PS", "Palestine", "Sawa", "phone", "164"),
  route("QA", "Qatar", "Hotline", "phone", "919"),
  route("SA", "Saudi Arabia", "Saudi Child Helpline", "phone", "116111"),
  route("SD", "Sudan", "Child Helpline", "phone", "9696"),
  route("AE", "United Arab Emirates", "Child Helpline", "phone", "800 700"),
];

const GLOBAL_ROUTES = [
  {
    id: "child-helpline-international",
    purpose: "child_support",
    name: "Child Helpline International",
    coverage:
      "150+ member child helplines across 130+ countries and territories; more than 50 countries still lack a national child helpline.",
    url: CHI_DIRECTORY,
    instruction:
      "Use the country directory to find a verified local child helpline. XGuard does not invent a local number when none is published.",
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "inhope",
    purpose: "csam_report",
    name: "INHOPE",
    coverage: "58 member hotlines in 53 countries on the current network page.",
    url: INHOPE_DIRECTORY,
    reportingUrl: INHOPE_REPORTING,
    instruction:
      "Use an authorised local hotline or portal to report suspected CSAM. Never email or forward CSAM files; report the URL and requested details through the official hotline workflow.",
    verifiedAt: VERIFIED_AT,
  },
  {
    id: "ncmec-cybertipline",
    purpose: "online_exploitation_report",
    name: "NCMEC CyberTipline",
    coverage:
      "NCMEC reports law-enforcement partnerships in 170 countries and territories, with Interpol assisting where a direct connection is unavailable.",
    url: NCMEC_CYBERTIPLINE,
    instruction:
      "Use the CyberTipline for suspected online child sexual exploitation. Follow its official submission process rather than sending abuse material by ordinary email.",
    verifiedAt: VERIFIED_AT,
  },
] as const;

export function childSafetyReportingDirectoryResponse(
  request: Request,
): Response | null {
  if (request.method !== "GET") return null;
  const url = new URL(request.url);

  if (url.pathname === "/v1/child-safety/reporting-directory") {
    const countryCode = normalizeCountryCode(url.searchParams.get("country"));
    const local = countryCode
      ? LOCAL_ROUTES.filter((item) => item.countryCode === countryCode)
      : LOCAL_ROUTES;
    return json({
      verifiedAt: VERIFIED_AT,
      country: countryCode || null,
      local,
      global: GLOBAL_ROUTES,
      emergencyBoundary:
        "For immediate physical danger, contact the emergency or police service for the child's current location. XGuard is not an emergency response authority.",
      evidenceBoundary:
        "Do not send child sexual abuse material to XGuard or by ordinary email. Use the authorised reporting portal for the relevant jurisdiction.",
    });
  }

  if (url.pathname === "/child-safety/reporting-directory") {
    return html(renderDirectory());
  }

  return null;
}

function route(
  countryCode: string,
  country: string,
  organization: string,
  channel: "phone" | "directory",
  value: string,
  scope?: string,
): LocalRoute {
  return {
    countryCode,
    country,
    organization,
    channel,
    value,
    ...(scope ? { scope } : {}),
    purpose: "child_support",
    source: CHI_DIRECTORY,
    verifiedAt: VERIFIED_AT,
  };
}

function normalizeCountryCode(value: string | null): string {
  const code = (value ?? "").trim().toUpperCase();
  return /^[A-Z]{2}$/.test(code) ? code : "";
}

function renderDirectory(): string {
  const localRows = LOCAL_ROUTES.map((item) => {
    const contact =
      item.channel === "phone"
        ? `<strong>${esc(item.value)}</strong>`
        : `<a href="${esc(item.value)}" rel="noreferrer">Official directory</a>`;
    return `<tr><td>${esc(item.country)}</td><td>${esc(item.organization)}</td><td>${contact}</td><td>${esc(item.scope ?? "National / directory listing")}</td></tr>`;
  }).join("");

  const globalCards = GLOBAL_ROUTES.map(
    (item) =>
      `<article><h2>${esc(item.name)}</h2><p>${esc(item.coverage)}</p><p>${esc(item.instruction)}</p><a href="${esc(item.url)}" rel="noreferrer">Open official route →</a></article>`,
  ).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="description" content="Verified child-safety help and reporting routes used by XGuard."><title>Global Child Safety Reporting Directory — XGuard</title><style>${styles()}</style></head><body><main><a class="brand" href="/child-safety">XGuard.</a><p class="eyebrow">Verified reporting routes · ${VERIFIED_AT}</p><h1>Get the right help.<br>Use the right reporting channel.</h1><p class="lead">XGuard separates child-support helplines from CSAM hotlines and online-exploitation reporting. We publish a direct number only when a current authoritative directory provides it.</p><section class="warning"><strong>Do not send abuse material to XGuard.</strong><p>Never email, forward or upload suspected child sexual abuse material through XGuard contact channels. Use an authorised hotline or reporting portal and follow its evidence-handling instructions.</p></section><section class="cards">${globalCards}</section><section><h2>Currently verified direct child-support routes</h2><p class="muted">This table is deliberately incomplete. Child Helpline International states that more than 50 countries still lack a national child helpline, so XGuard falls back to official global directories rather than fabricating a number.</p><div class="table"><table><thead><tr><th>Country</th><th>Service</th><th>Contact</th><th>Scope</th></tr></thead><tbody>${localRows}</tbody></table></div></section><section class="emergency"><h2>Immediate danger</h2><p>If a child is in immediate physical danger, contact the local emergency or police service for the child's current location. XGuard is a technology provider, not an emergency-response authority.</p></section></main></body></html>`;
}

function json(value: unknown): Response {
  return new Response(JSON.stringify(value), {
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
      "Cache-Control": "public, max-age=300",
      "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
  });
}

function esc(value: string): string {
  return value.replace(/[&<>"]/g, (character) => {
    if (character === "&") return "&amp;";
    if (character === "<") return "&lt;";
    if (character === ">") return "&gt;";
    return "&quot;";
  });
}

function styles(): string {
  return `*{box-sizing:border-box}body{margin:0;background:#080a0e;color:#f7f8fb;font-family:Arial,sans-serif}main{max-width:1120px;margin:auto;padding:60px 24px 90px}.brand{font-size:25px;font-weight:800;color:#fff;text-decoration:none}.eyebrow{margin-top:60px;text-transform:uppercase;letter-spacing:.15em;color:#7faeff;font-size:12px;font-weight:800}h1{font-size:clamp(45px,7vw,80px);line-height:.98;letter-spacing:-.04em;margin:16px 0 24px}.lead,.muted,article p,.warning p,.emergency p{color:#b8bec8;font-size:17px;line-height:1.7}.warning,.emergency{padding:24px;border-radius:16px;border:1px solid #353e4b;background:#11161d;margin:30px 0}.warning{border-color:#765747}.cards{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin:30px 0 50px}article{border:1px solid #252c36;background:#10141a;border-radius:16px;padding:24px}article a,.table a{color:#90b7ff}h2{font-size:25px}.table{overflow:auto;border:1px solid #252c36;border-radius:16px;margin-top:20px}table{width:100%;border-collapse:collapse;min-width:760px}th,td{text-align:left;padding:15px;border-bottom:1px solid #252c36}th{color:#9fc0ff;font-size:13px;text-transform:uppercase;letter-spacing:.08em}@media(max-width:800px){.cards{grid-template-columns:1fr}main{padding-top:35px}}`;
}
