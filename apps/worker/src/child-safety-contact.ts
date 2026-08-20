interface ChildSafetyContactEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER: RateLimit;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
}

interface ContactInput {
  organization?: string;
  roleTitle?: string;
  country?: string;
  email?: string;
  website?: string;
  inquiryType?: string;
  message?: string;
  homepage2?: string;
}

const INQUIRY_TYPES = new Set([
  "government",
  "regulator",
  "platform",
  "ngo",
  "education",
  "telecom",
  "research",
  "other",
]);

export async function childSafetyContactResponse(
  request: Request,
  env: ChildSafetyContactEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (request.method === "GET" && url.pathname === "/child-safety/contact") {
    return html(contactPage());
  }

  if (
    request.method === "OPTIONS" &&
    url.pathname === "/v1/child-safety/contact"
  ) {
    return new Response(null, {
      status: 204,
      headers: corsHeaders(),
    });
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/child-safety/contact"
  ) {
    const rateBlock = await rateLimit(request, env);
    if (rateBlock) return rateBlock;

    const input = await readJson<ContactInput>(request);
    if (!input) return json({ error: "invalid_json" }, 400);

    if (clean(input.homepage2, 50)) {
      return json({ accepted: true }, 202);
    }

    const organization = clean(input.organization, 180);
    const roleTitle = clean(input.roleTitle, 160);
    const country = clean(input.country, 120);
    const email = cleanEmail(input.email);
    const website = cleanUrl(input.website);
    const inquiryType = clean(input.inquiryType, 40).toLowerCase();
    const message = clean(input.message, 4_000);

    if (!organization) return json({ error: "organization_required" }, 400);
    if (!email) return json({ error: "valid_email_required" }, 400);
    if (!INQUIRY_TYPES.has(inquiryType)) {
      return json({ error: "invalid_inquiry_type" }, 400);
    }
    if (message.length < 20) return json({ error: "message_too_short" }, 400);

    const now = new Date().toISOString();
    const contactId = crypto.randomUUID();
    const ipHash = await sourceIpHash(request);

    await env.DB.prepare(
      "INSERT INTO child_safety_institutional_contacts(contact_id,organization,role_title,country,contact_email,website,inquiry_type,message,source_ip_hash,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",
    )
      .bind(
        contactId,
        organization,
        roleTitle,
        country,
        email,
        website,
        inquiryType,
        message,
        ipHash,
        "NEW",
        now,
        now,
      )
      .run();

    return json(
      {
        accepted: true,
        contactId,
        message:
          "Your institutional enquiry has been recorded directly by XGuard. Do not submit child case data or abuse material through this channel.",
      },
      201,
    );
  }

  if (request.method === "GET" && url.pathname === "/v1/child-safety/contact") {
    if (!(await isAdmin(request, env))) {
      return json({ error: "unauthorized" }, 401);
    }

    const result = await env.DB.prepare(
      "SELECT contact_id,organization,role_title,country,contact_email,website,inquiry_type,message,status,created_at FROM child_safety_institutional_contacts ORDER BY created_at DESC LIMIT 100",
    ).all();

    return json({ contacts: result.results ?? [] });
  }

  return null;
}

async function rateLimit(
  request: Request,
  env: ChildSafetyContactEnv,
): Promise<Response | null> {
  const ip = clean(
    request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-real-ip") ??
      "unknown",
    128,
  );
  try {
    const result = await env.REQUEST_RATE_LIMITER.limit({
      key: `child-safety-contact:${ip || "unknown"}`,
    });
    if (result.success) return null;
    return json({ error: "rate_limit_exceeded" }, 429, { "Retry-After": "60" });
  } catch {
    return json({ error: "contact_protection_unavailable" }, 503);
  }
}

async function sourceIpHash(request: Request): Promise<string | null> {
  const ip = clean(
    request.headers.get("cf-connecting-ip") ?? request.headers.get("x-real-ip"),
    128,
  );
  if (!ip) return null;
  return sha256(`xguard-child-safety-contact:${ip}`);
}

async function isAdmin(
  request: Request,
  env: ChildSafetyContactEnv,
): Promise<boolean> {
  const expected = clean(env.XGUARD_ADMIN_TOKEN_SHA256, 64).toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(expected)) return false;
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization.startsWith("Bearer ")) return false;
  const token = authorization.slice(7).trim();
  if (!token) return false;
  return (await sha256(token)) === expected;
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanEmail(value: unknown): string {
  const email = clean(value, 320).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function cleanUrl(value: unknown): string {
  const raw = clean(value, 500);
  if (!raw) return "";
  try {
    const parsed = new URL(raw);
    return parsed.protocol === "https:" || parsed.protocol === "http:"
      ? parsed.toString().slice(0, 500)
      : "";
  } catch {
    return "";
  }
}

async function readJson<T>(request: Request): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "https://xguardgate.com",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function json(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      ...corsHeaders(),
      ...extraHeaders,
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

function contactPage(): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Institutional Contact — XGuard</title><style>*{box-sizing:border-box}body{margin:0;background:#080a0e;color:#f7f8fb;font-family:Arial,sans-serif}main{max-width:820px;margin:auto;padding:70px 24px}.brand{color:#fff;text-decoration:none;font-size:24px;font-weight:800}h1{font-size:clamp(42px,7vw,72px);line-height:1;margin:50px 0 20px}p{color:#b8bec8;line-height:1.7;font-size:17px}.notice{border:1px solid #2a3442;background:#11161d;border-radius:16px;padding:18px;margin:28px 0}form{display:grid;gap:16px;margin-top:32px}label{display:grid;gap:7px;color:#dce2ea;font-weight:700}input,select,textarea{width:100%;border:1px solid #303846;background:#10141a;color:#fff;border-radius:12px;padding:13px;font:inherit}textarea{min-height:160px;resize:vertical}button{border:0;border-radius:12px;padding:14px 18px;background:#e8f1ff;color:#10141b;font-weight:800;cursor:pointer}.grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.hidden{position:absolute;left:-9999px}#status{min-height:24px;color:#9fc0ff}@media(max-width:700px){.grid{grid-template-columns:1fr}}</style></head><body><main><a class="brand" href="/child-safety">XGuard.</a><h1>Institutional contact.</h1><p>For governments, regulators, platforms, NGOs, schools, telecoms and research organizations interested in child-safety integration or a limited pilot.</p><div class="notice"><strong>Safeguarding boundary:</strong><p>Do not send names, images, conversations, case files or any personal data about children through this form. Do not upload or transmit suspected child sexual abuse material. This channel is only for institutional and commercial enquiries.</p></div><form id="contact"><div class="grid"><label>Organization<input name="organization" required maxlength="180"></label><label>Your role<input name="roleTitle" maxlength="160"></label></div><div class="grid"><label>Country / jurisdiction<input name="country" maxlength="120"></label><label>Work email<input name="email" type="email" required maxlength="320"></label></div><div class="grid"><label>Organization website<input name="website" type="url" maxlength="500" placeholder="https://"></label><label>Enquiry type<select name="inquiryType" required><option value="">Select</option><option value="government">Government</option><option value="regulator">Regulator</option><option value="platform">Online platform / app</option><option value="ngo">NGO / child protection</option><option value="education">School / education</option><option value="telecom">Telecom / ISP</option><option value="research">Research</option><option value="other">Other</option></select></label></div><label>What would you like to discuss?<textarea name="message" required minlength="20" maxlength="4000"></textarea></label><label class="hidden">Homepage<input name="homepage2" tabindex="-1" autocomplete="off"></label><button type="submit">Submit institutional enquiry</button><div id="status" aria-live="polite"></div></form><script>const f=document.getElementById('contact'),s=document.getElementById('status');f.addEventListener('submit',async(e)=>{e.preventDefault();s.textContent='Submitting…';const d=Object.fromEntries(new FormData(f).entries());try{const r=await fetch('/v1/child-safety/contact',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});const j=await r.json();if(!r.ok)throw new Error(j.error||'Unable to submit');s.textContent='Received. XGuard recorded your institutional enquiry.';f.reset()}catch(err){s.textContent=err instanceof Error?err.message:'Unable to submit'}});</script></main></body></html>`;
}
