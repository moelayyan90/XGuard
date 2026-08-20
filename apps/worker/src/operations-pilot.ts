interface PilotEnv {
  DB: D1Database;
  REQUEST_RATE_LIMITER: RateLimit;
}

function clean(value: unknown, max: number): string | null {
  if (typeof value !== "string") return null;
  const result = value
    .trim()
    .split("")
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("")
    .slice(0, max);
  return result.length > 0 ? result : null;
}

function emailOk(value: string | null): boolean {
  return value !== null && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

function html(message: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard Pilot</title><style>body{font-family:Inter,system-ui,sans-serif;background:#f3f5ef;color:#10110f;margin:0}.box{max-width:720px;margin:10vh auto;background:#fff;border:1px solid #d8dcd0;border-radius:24px;padding:34px}h1{font-size:42px;letter-spacing:-.05em;margin:0 0 16px}p{font-size:18px;line-height:1.6;color:#4d5148}a{display:inline-block;margin-top:12px;background:#10110f;color:#fff;text-decoration:none;padding:13px 18px;border-radius:999px;font-weight:800}</style></head><body><main class="box"><h1>${message}</h1><p>Your request is now recorded inside XGuard. We will use the details you supplied to evaluate the workflow and pilot scope.</p><a href="/">Back to XGuard</a></main></body></html>`,
    {
      status,
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
        "Referrer-Policy": "strict-origin-when-cross-origin",
        "Content-Security-Policy":
          "default-src 'self'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'",
      },
    },
  );
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type",
      "Access-Control-Allow-Methods": "POST, OPTIONS",
    },
  });
}

async function payload(
  request: Request,
): Promise<Record<string, unknown> | null> {
  const type = request.headers.get("content-type")?.toLowerCase() ?? "";
  try {
    if (type.includes("application/json")) {
      const value = await request.json();
      return typeof value === "object" &&
        value !== null &&
        !Array.isArray(value)
        ? (value as Record<string, unknown>)
        : null;
    }
    if (
      type.includes("application/x-www-form-urlencoded") ||
      type.includes("multipart/form-data")
    ) {
      return Object.fromEntries(await request.formData());
    }
  } catch {
    return null;
  }
  return null;
}

export async function operationsPilotResponse(
  request: Request,
  env: PilotEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/v1/operations/pilot") return null;

  if (request.method === "OPTIONS") return new Response(null, { status: 204 });
  if (request.method !== "POST")
    return json({ error: "method_not_allowed" }, 405);

  const client = (
    request.headers.get("cf-connecting-ip") ??
    request.headers.get("x-real-ip") ??
    "unknown"
  )
    .trim()
    .slice(0, 128);

  try {
    const decision = await env.REQUEST_RATE_LIMITER.limit({
      key: `operations:pilot:${client}`,
    });
    if (!decision.success) return json({ error: "rate_limit_exceeded" }, 429);
  } catch {
    return json({ error: "protection_unavailable" }, 503);
  }

  const body = await payload(request);
  if (!body) return json({ error: "invalid_request" }, 400);

  const honeypot = clean(body.contactFax, 100);
  if (honeypot) return html("Pilot request received");

  const organisationName = clean(body.organisationName, 180);
  const contactName = clean(body.contactName, 160);
  const contactEmail = clean(body.contactEmail, 254)?.toLowerCase() ?? null;
  const countryCode = clean(body.countryCode, 2)?.toUpperCase() ?? null;
  const website = clean(body.website, 240);
  const workflowInterest = clean(body.workflowInterest, 120);
  const message = clean(body.message, 3000);
  const estimatedRaw = clean(body.estimatedMonthlyCases, 12);
  const estimatedMonthlyCases =
    estimatedRaw === null ? null : Number.parseInt(estimatedRaw, 10);

  if (
    !organisationName ||
    !emailOk(contactEmail) ||
    !workflowInterest ||
    (countryCode !== null && !/^[A-Z]{2}$/.test(countryCode)) ||
    (estimatedMonthlyCases !== null &&
      (!Number.isInteger(estimatedMonthlyCases) ||
        estimatedMonthlyCases < 0 ||
        estimatedMonthlyCases > 100000000))
  ) {
    return json({ error: "invalid_fields" }, 400);
  }

  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO operations_pilot_requests (id, organisation_name, contact_name, contact_email, country_code, website, workflow_interest, estimated_monthly_cases, message, source, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'website', 'NEW', ?, ?) ON CONFLICT(contact_email, organisation_name) DO UPDATE SET contact_name = excluded.contact_name, country_code = excluded.country_code, website = excluded.website, workflow_interest = excluded.workflow_interest, estimated_monthly_cases = excluded.estimated_monthly_cases, message = excluded.message, status = 'NEW', updated_at = excluded.updated_at",
  )
    .bind(
      id,
      organisationName,
      contactName,
      contactEmail,
      countryCode,
      website,
      workflowInterest,
      estimatedMonthlyCases,
      message,
      now,
      now,
    )
    .run();

  const wantsHtml = !request.headers
    .get("content-type")
    ?.toLowerCase()
    .includes("application/json");
  if (wantsHtml) return html("Pilot request received");

  return json(
    {
      status: "RECEIVED",
      organisationName,
      workflowInterest,
      receivedAt: now,
    },
    201,
  );
}
