interface EudrEnv {
  DB: D1Database;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
}

interface JsonRecord {
  [key: string]: unknown;
}

const JSON_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Cache-Control": "no-store",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Authorization, Content-Type, X-XGuard-Admin",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "Content-Security-Policy":
        "default-src 'self'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    },
  });
}

async function sha256(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function cleanString(
  value: unknown,
  max: number,
  required = false,
): string | null {
  if (typeof value !== "string") return required ? "" : null;
  const clean = value
    .trim()
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, max);
  if (required && clean.length === 0) return "";
  return clean.length === 0 ? null : clean;
}

function isEmail(value: string | null): boolean {
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function normalizeSlug(value: unknown): string {
  const raw = typeof value === "string" ? value : "";
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function randomToken(prefix: string): string {
  return `${prefix}${crypto.randomUUID().replaceAll("-", "")}${crypto.randomUUID().replaceAll("-", "")}`;
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  try {
    const value = await request.json();
    if (typeof value !== "object" || value === null || Array.isArray(value))
      return null;
    return value as JsonRecord;
  } catch {
    return null;
  }
}

async function requireAdmin(request: Request, env: EudrEnv): Promise<boolean> {
  const expected = env.XGUARD_ADMIN_TOKEN_SHA256?.trim();
  if (!expected) return false;
  const supplied = request.headers.get("x-xguard-admin")?.trim();
  if (!supplied) return false;
  return (await sha256(supplied)) === expected;
}

const READINESS_FIELDS = [
  "scopeMapped",
  "rolesConfirmed",
  "suppliersMapped",
  "cnCodesMapped",
  "geolocationReady",
  "sourceDataMapped",
  "retentionPolicyReady",
  "euCredentialsReady",
  "testFlowCompleted",
] as const;

function readiness(body: JsonRecord) {
  const completed = READINESS_FIELDS.filter(
    (field) => body[field] === true,
  ).length;
  const readinessPercent = completed * 10;
  return {
    readinessPercent,
    remainingExecutionPercent: 100 - readinessPercent,
    completed,
    totalReadinessChecks: READINESS_FIELDS.length,
    message:
      readinessPercent >= 90
        ? "Operational readiness is complete. The remaining 10% is transaction execution when a real EUDR movement occurs."
        : "Build readiness before live traffic: map roles, suppliers, product codes, geolocation, source data, retention, credentials and a tested flow.",
  };
}

function landingPage(): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>XGuard EUDR Inbox — Be ready before the shipment</title>
<meta name="description" content="A supplier-to-buyer EUDR reference exchange and readiness layer. Free inbound DDS reference intake; paid value only where verification or submission work is performed.">
<style>
:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#111;background:#f5f6f2}*{box-sizing:border-box}body{margin:0}.wrap{max-width:1120px;margin:auto;padding:28px}.nav{display:flex;justify-content:space-between;align-items:center}.brand{font-weight:800;letter-spacing:-.03em;font-size:24px}.pill{border:1px solid #111;border-radius:999px;padding:10px 14px;text-decoration:none;color:#111}.hero{padding:86px 0 54px;max-width:900px}h1{font-size:clamp(46px,8vw,92px);line-height:.92;letter-spacing:-.065em;margin:0 0 28px}.lead{font-size:22px;line-height:1.45;max-width:760px;color:#34362f}.accent{background:#dfff45;padding:0 .08em}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin:30px 0}.card{background:#fff;border:1px solid #d9dccf;border-radius:18px;padding:24px}.card b{font-size:30px;display:block;margin-bottom:8px}.flow{background:#111;color:white;border-radius:24px;padding:34px;margin:44px 0}.flow code{white-space:normal;font-size:18px;line-height:1.8}.cta{display:inline-block;background:#111;color:white;text-decoration:none;padding:15px 20px;border-radius:12px;font-weight:700}.fine{color:#65685d;font-size:13px;line-height:1.5;margin:35px 0 60px}@media(max-width:760px){.grid{grid-template-columns:1fr}.hero{padding-top:54px}}</style></head>
<body><main class="wrap"><nav class="nav"><div class="brand">XGuard EUDR Inbox</div><a class="pill" href="mailto:info@xguardgate.com?subject=EUDR%20Inbox%20Pilot">Pilot access</a></nav>
<section class="hero"><h1><span class="accent">90% is readiness.</span><br>The last 10% is execution.</h1>
<p class="lead">Do not wait for a live shipment to discover that supplier references, product data, geolocation, roles, credentials and retention workflows are incomplete. XGuard turns EUDR preparation into a repeatable supplier-to-buyer reference flow before production pressure begins.</p>
<a class="cta" href="mailto:info@xguardgate.com?subject=Make%20XGuard%20our%20EUDR%20Inbox">Make XGuard our EUDR Inbox</a></section>
<div class="grid"><div class="card"><b>Free</b>Inbound DDS-reference collection for participating buyers.</div><div class="card"><b>Default</b>A single supplier instruction: “Send EUDR references through our XGuard Inbox.”</div><div class="card"><b>Paid value</b>Verification, submission and operational services are monetised only where real work is performed.</div></div>
<section class="flow"><code>Buyer / ERP / customs workflow → XGuard Inbox → supplier reference intake → validation & evidence → downstream EUDR workflow</code></section>
<div class="grid"><div class="card"><b>For buyers</b>Stop chasing DDS references through email and spreadsheets.</div><div class="card"><b>For suppliers</b>One structured place to send the reference your customer requests.</div><div class="card"><b>For partners</b>Embed the Inbox as the default EUDR handoff and participate in paid downstream value.</div></div>
<p class="fine">XGuard is an independent software service and is not an EU institution or competent authority. EUDR legal responsibility remains with the legally responsible operator/trader as applicable. This surface does not claim that XGuard is legally mandatory; it is designed to become the default operational exchange chosen by participating organisations.</p>
</main></body></html>`;
}

function inboxPage(slug: string, organisationName: string): string {
  const escapedOrg = organisationName.replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ] ?? c,
  );
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapedOrg} — XGuard EUDR Inbox</title><style>body{font-family:system-ui;margin:0;background:#f6f7f3;color:#111}.box{max-width:700px;margin:7vh auto;background:#fff;padding:34px;border-radius:20px;border:1px solid #ddd}input{width:100%;padding:12px;margin:6px 0 14px;border:1px solid #bbb;border-radius:9px}button{background:#111;color:#fff;border:0;padding:13px 18px;border-radius:10px;font-weight:700}.note{font-size:13px;color:#666}</style></head><body><div class="box"><h1>${escapedOrg}<br>EUDR Reference Inbox</h1><p>Submit the DDS reference requested by this customer. XGuard records a timestamped evidence receipt and prevents duplicate intake for the same shipment/reference pair.</p><form id="f"><label>Supplier name</label><input name="supplierName" required maxlength="160"><label>Supplier email</label><input name="supplierEmail" type="email" maxlength="254"><label>DDS reference</label><input name="ddsReference" required maxlength="160"><label>Verification number</label><input name="verificationNumber" maxlength="160"><label>Shipment / PO reference</label><input name="shipmentReference" maxlength="160"><label>Product description</label><input name="productDescription" maxlength="240"><label>Origin country</label><input name="originCountry" maxlength="120"><button>Send reference</button></form><pre id="r"></pre><p class="note">The verification number is hashed before storage by this intake surface. External EU-system verification is a separate capability and is not implied by submission here.</p></div><script>document.getElementById('f').addEventListener('submit',async(e)=>{e.preventDefault();const d=Object.fromEntries(new FormData(e.target).entries());const r=await fetch('/v1/eudr/inboxes/${encodeURIComponent(slug)}/references',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});document.getElementById('r').textContent=JSON.stringify(await r.json(),null,2);if(r.ok)e.target.reset();});</script></body></html>`;
}

export async function eudrNetworkResponse(
  request: Request,
  env: EudrEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS" && url.pathname.startsWith("/v1/eudr/")) {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (
    request.method === "GET" &&
    (url.pathname === "/" ||
      url.pathname === "/eudr" ||
      url.pathname === "/eudr/")
  ) {
    return html(landingPage());
  }

  if (request.method === "POST" && url.pathname === "/v1/eudr/readiness") {
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_json" }, 400);
    return json(readiness(body));
  }

  if (request.method === "POST" && url.pathname === "/v1/eudr/inboxes") {
    if (!(await requireAdmin(request, env)))
      return json({ error: "unauthorized" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_json" }, 400);
    const organisationName = cleanString(body.organisationName, 180, true);
    const contactEmail = cleanString(body.contactEmail, 254, true);
    let slug = normalizeSlug(body.slug ?? organisationName);
    if (!organisationName || !contactEmail || !isEmail(contactEmail))
      return json({ error: "invalid_fields" }, 400);
    if (!slug) slug = `inbox-${crypto.randomUUID().slice(0, 8)}`;
    const adminKey = randomToken("xg_eudr_");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    try {
      await env.DB.prepare(
        "INSERT INTO eudr_inboxes (id, slug, organisation_name, contact_email, admin_key_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          slug,
          organisationName,
          contactEmail,
          await sha256(adminKey),
          createdAt,
        )
        .run();
    } catch {
      return json({ error: "slug_unavailable" }, 409);
    }
    return json(
      {
        id,
        slug,
        organisationName,
        publicInbox: `${url.origin}/eudr/inbox/${slug}`,
        adminKey,
        pricing: {
          inboundReferenceIntake: "free",
          verification: "paid_when_enabled",
          filing: "paid_when_enabled",
        },
      },
      201,
    );
  }

  const inboxPageMatch = url.pathname.match(
    /^\/eudr\/inbox\/([a-z0-9-]{1,48})$/,
  );
  if (request.method === "GET" && inboxPageMatch) {
    const slug = inboxPageMatch[1];
    const row = await env.DB.prepare(
      "SELECT organisation_name FROM eudr_inboxes WHERE slug = ?",
    )
      .bind(slug)
      .first<{ organisation_name: string }>();
    if (!row) return html("<h1>Inbox not found</h1>", 404);
    return html(inboxPage(slug, row.organisation_name));
  }

  const referenceMatch = url.pathname.match(
    /^\/v1\/eudr\/inboxes\/([a-z0-9-]{1,48})\/references$/,
  );
  if (request.method === "POST" && referenceMatch) {
    const slug = referenceMatch[1];
    const inbox = await env.DB.prepare(
      "SELECT id, organisation_name FROM eudr_inboxes WHERE slug = ?",
    )
      .bind(slug)
      .first<{ id: string; organisation_name: string }>();
    if (!inbox) return json({ error: "inbox_not_found" }, 404);
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_json" }, 400);
    const supplierName = cleanString(body.supplierName, 160, true);
    const supplierEmail = cleanString(body.supplierEmail, 254);
    const ddsReference = cleanString(body.ddsReference, 160, true);
    const verificationNumber = cleanString(body.verificationNumber, 160);
    const shipmentReference = cleanString(body.shipmentReference, 160);
    const productDescription = cleanString(body.productDescription, 240);
    const originCountry = cleanString(body.originCountry, 120);
    if (
      !supplierName ||
      !ddsReference ||
      (supplierEmail !== null && !isEmail(supplierEmail))
    )
      return json({ error: "invalid_fields" }, 400);
    const id = crypto.randomUUID();
    const receivedAt = new Date().toISOString();
    const verificationHash = verificationNumber
      ? await sha256(verificationNumber)
      : null;
    const evidenceHash = await sha256(
      JSON.stringify({
        inboxId: inbox.id,
        supplierName,
        supplierEmail,
        ddsReference,
        verificationHash,
        shipmentReference,
        productDescription,
        originCountry,
        receivedAt,
      }),
    );
    try {
      await env.DB.prepare(
        "INSERT INTO eudr_reference_intake (id, inbox_id, supplier_name, supplier_email, dds_reference, verification_number_sha256, shipment_reference, product_description, origin_country, evidence_sha256, received_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      )
        .bind(
          id,
          inbox.id,
          supplierName,
          supplierEmail,
          ddsReference,
          verificationHash,
          shipmentReference,
          productDescription,
          originCountry,
          evidenceHash,
          receivedAt,
        )
        .run();
    } catch {
      return json(
        {
          error: "duplicate_reference",
          message:
            "This DDS reference / shipment pair is already recorded for this inbox.",
        },
        409,
      );
    }
    return json(
      {
        receiptId: id,
        inbox: inbox.organisation_name,
        ddsReference,
        shipmentReference,
        status: "RECEIVED",
        evidenceSha256: evidenceHash,
        receivedAt,
        charge: {
          amount: 0,
          currency: "EUR",
          reason: "inbound_reference_intake_is_free",
        },
        next: "External verification or filing is a separate paid capability when enabled.",
      },
      201,
    );
  }

  const summaryMatch = url.pathname.match(
    /^\/v1\/eudr\/inboxes\/([a-z0-9-]{1,48})\/summary$/,
  );
  if (request.method === "GET" && summaryMatch) {
    const slug = summaryMatch[1];
    const adminKey = request.headers
      .get("authorization")
      ?.replace(/^Bearer\s+/i, "")
      .trim();
    if (!adminKey) return json({ error: "unauthorized" }, 401);
    const inbox = await env.DB.prepare(
      "SELECT id, organisation_name, admin_key_sha256, created_at FROM eudr_inboxes WHERE slug = ?",
    )
      .bind(slug)
      .first<{
        id: string;
        organisation_name: string;
        admin_key_sha256: string;
        created_at: string;
      }>();
    if (!inbox || (await sha256(adminKey)) !== inbox.admin_key_sha256)
      return json({ error: "unauthorized" }, 401);
    const count = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM eudr_reference_intake WHERE inbox_id = ?",
    )
      .bind(inbox.id)
      .first<{ n: number }>();
    return json({
      organisationName: inbox.organisation_name,
      createdAt: inbox.created_at,
      inboundReferences: Number(count?.n ?? 0),
      commercialModel: {
        inboundReferenceIntake: "free",
        paidVerification: "planned",
        paidSubmission: "planned",
        partnerRevenueShare: "available_by_agreement",
      },
    });
  }

  return null;
}
