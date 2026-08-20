interface OperationsEnv {
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

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
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

function isCountryCode(value: string | null): boolean {
  return value !== null && /^[A-Z]{2}$/.test(value);
}

function isPriority(value: string | null): value is "LOW" | "NORMAL" | "HIGH" {
  return value === "LOW" || value === "NORMAL" || value === "HIGH";
}

function parseIsoDate(value: string | null): string | null {
  if (value === null) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function readJson(request: Request): Promise<JsonRecord | null> {
  try {
    const parsed = await request.json();
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed))
      return null;
    return parsed as JsonRecord;
  } catch {
    return null;
  }
}

async function requireAdmin(
  request: Request,
  env: OperationsEnv,
): Promise<boolean> {
  const expected = env.XGUARD_ADMIN_TOKEN_SHA256?.trim();
  const token = request.headers.get("x-xguard-admin")?.trim();
  if (!expected || !token) return false;
  return (await sha256(token)) === expected;
}

function randomSecret(): string {
  return `${crypto.randomUUID().replaceAll("-", "")}${crypto
    .randomUUID()
    .replaceAll("-", "")}`;
}

function parseOrganisationIdFromKey(token: string): string | null {
  const match = token.match(/^xg_ops_([a-f0-9]{32})\.[a-f0-9]{64}$/);
  return match?.[1] ?? null;
}

async function authenticateOrganisation(
  request: Request,
  env: OperationsEnv,
): Promise<{ id: string; name: string } | null> {
  const token = request.headers
    .get("authorization")
    ?.replace(/^Bearer\s+/i, "")
    .trim();
  if (!token) return null;
  const organisationId = parseOrganisationIdFromKey(token);
  if (!organisationId) return null;
  const row = await env.DB.prepare(
    "SELECT id, name, api_key_sha256 FROM operations_organisations WHERE id = ?",
  )
    .bind(organisationId)
    .first<{ id: string; name: string; api_key_sha256: string }>();
  if (!row || (await sha256(token)) !== row.api_key_sha256) return null;
  return { id: row.id, name: row.name };
}

async function appendEvent(
  env: OperationsEnv,
  taskId: string,
  eventType: string,
  actorType: string,
  details: JsonRecord,
): Promise<void> {
  const createdAt = new Date().toISOString();
  const detailsJson = JSON.stringify(details);
  const eventHash = await sha256(
    JSON.stringify({ taskId, eventType, actorType, details, createdAt }),
  );
  await env.DB.prepare(
    "INSERT INTO operations_task_events (id, task_id, event_type, actor_type, details_json, event_sha256, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
  )
    .bind(
      crypto.randomUUID(),
      taskId,
      eventType,
      actorType,
      detailsJson,
      eventHash,
      createdAt,
    )
    .run();
}

const CATALOG = {
  product: "XGuard Smart Cross-Border Operations Employee",
  operatingPrinciple:
    "90% is readiness. The final 10% is live execution. This is an XGuard operating framework, not a legal statistic.",
  workflows: [
    {
      id: "eudr_operations",
      status: "focused_launch",
      geography: ["EU"],
      capabilities: [
        "readiness",
        "supplier_reference_intake",
        "supplier_follow_up_workflow",
        "evidence_organisation",
        "geodata_preflight",
        "case_assembly",
        "audit_history",
        "reference_handoff",
      ],
      executionBoundary:
        "EU-system submission is enabled only after the participant's authority/credentials and the production integration are validated.",
      launchPricing: {
        readinessEur: 0,
        completedCaseEur: 9,
        volumeCompletedCaseEur: "4-6",
      },
    },
    {
      id: "cross_border_task_intake",
      status: "foundation",
      geography: "configured_jurisdictions_only",
      capabilities: [
        "task_intake",
        "country_authority_routing_metadata",
        "deadline_tracking",
        "language_metadata",
        "exception_visibility",
        "audit_events",
      ],
      executionBoundary:
        "A government/customs workflow is not represented as executable until its authoritative rules, channel, credentials and validation are configured.",
    },
  ],
} as const;

export async function operationsEmployeeResponse(
  request: Request,
  env: OperationsEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "OPTIONS" &&
    url.pathname.startsWith("/v1/operations/")
  ) {
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  if (request.method === "GET" && url.pathname === "/v1/operations/catalog") {
    return json(CATALOG);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/operations/organisations"
  ) {
    if (!(await requireAdmin(request, env)))
      return json({ error: "unauthorized" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_json" }, 400);

    const name = cleanString(body.name, 180, true);
    const contactEmail = cleanString(body.contactEmail, 254, true);
    const defaultLanguage = cleanString(body.defaultLanguage, 32) ?? "en";
    if (!name || !contactEmail || !isEmail(contactEmail))
      return json({ error: "invalid_fields" }, 400);

    const id = crypto.randomUUID().replaceAll("-", "");
    const apiKey = `xg_ops_${id}.${randomSecret()}`;
    const createdAt = new Date().toISOString();
    await env.DB.prepare(
      "INSERT INTO operations_organisations (id, name, contact_email, api_key_sha256, default_language, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
      .bind(
        id,
        name,
        contactEmail,
        await sha256(apiKey),
        defaultLanguage,
        createdAt,
      )
      .run();

    return json(
      {
        id,
        name,
        contactEmail,
        defaultLanguage,
        apiKey,
        warning: "The plaintext API key is returned once. Store it securely.",
      },
      201,
    );
  }

  if (request.method === "POST" && url.pathname === "/v1/operations/tasks") {
    const organisation = await authenticateOrganisation(request, env);
    if (!organisation) return json({ error: "unauthorized" }, 401);
    const body = await readJson(request);
    if (!body) return json({ error: "invalid_json" }, 400);

    const externalReference = cleanString(body.externalReference, 180);
    const countryCode =
      cleanString(body.countryCode, 2, true)?.toUpperCase() ?? "";
    const authority = cleanString(body.authority, 180);
    const workflowType = cleanString(body.workflowType, 80, true);
    const sourceLanguage = cleanString(body.sourceLanguage, 32);
    const preferredLanguage = cleanString(body.preferredLanguage, 32) ?? "en";
    const objective = cleanString(body.objective, 3000, true);
    const priorityCandidate =
      cleanString(body.priority, 12)?.toUpperCase() ?? "NORMAL";
    const dueAtRaw = cleanString(body.dueAt, 80);
    const dueAt = dueAtRaw === null ? null : parseIsoDate(dueAtRaw);

    if (
      !isCountryCode(countryCode) ||
      !workflowType ||
      !objective ||
      !isPriority(priorityCandidate) ||
      (dueAtRaw !== null && dueAt === null)
    ) {
      return json({ error: "invalid_fields" }, 400);
    }

    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    try {
      await env.DB.prepare(
        "INSERT INTO operations_tasks (id, organisation_id, external_reference, country_code, authority, workflow_type, source_language, preferred_language, objective, status, priority, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'RECEIVED', ?, ?, ?, ?)",
      )
        .bind(
          id,
          organisation.id,
          externalReference,
          countryCode,
          authority,
          workflowType,
          sourceLanguage,
          preferredLanguage,
          objective,
          priorityCandidate,
          dueAt,
          now,
          now,
        )
        .run();
    } catch {
      return json(
        {
          error: "duplicate_external_reference",
          message:
            "This external reference is already present for the organisation.",
        },
        409,
      );
    }

    await appendEvent(env, id, "TASK_RECEIVED", "CUSTOMER", {
      organisationId: organisation.id,
      countryCode,
      authority,
      workflowType,
      externalReference,
      priority: priorityCandidate,
      dueAt,
    });

    return json(
      {
        id,
        organisation: organisation.name,
        externalReference,
        countryCode,
        authority,
        workflowType,
        preferredLanguage,
        status: "RECEIVED",
        priority: priorityCandidate,
        dueAt,
        createdAt: now,
        next: "The task is recorded. Execution depends on the workflow being present in the validated XGuard supported catalog; unsupported workflows must be routed to configuration/review rather than falsely marked automated.",
      },
      201,
    );
  }

  const taskMatch = url.pathname.match(
    /^\/v1\/operations\/tasks\/([0-9a-f-]{36})$/,
  );
  if (request.method === "GET" && taskMatch) {
    const organisation = await authenticateOrganisation(request, env);
    if (!organisation) return json({ error: "unauthorized" }, 401);
    const taskId = taskMatch[1];
    const task = await env.DB.prepare(
      "SELECT id, external_reference, country_code, authority, workflow_type, source_language, preferred_language, objective, status, priority, due_at, exception_code, created_at, updated_at FROM operations_tasks WHERE id = ? AND organisation_id = ?",
    )
      .bind(taskId, organisation.id)
      .first<Record<string, unknown>>();
    if (!task) return json({ error: "task_not_found" }, 404);

    const events = await env.DB.prepare(
      "SELECT event_type, actor_type, details_json, event_sha256, created_at FROM operations_task_events WHERE task_id = ? ORDER BY created_at ASC LIMIT 250",
    )
      .bind(taskId)
      .all<Record<string, unknown>>();

    return json({ task, events: events.results ?? [] });
  }

  return null;
}

export async function operationsEmployeeScheduled(
  env: OperationsEnv,
): Promise<void> {
  const now = new Date().toISOString();
  await env.DB.prepare(
    "UPDATE operations_tasks SET status = 'EXCEPTION', exception_code = 'DEADLINE_REACHED', updated_at = ? WHERE due_at IS NOT NULL AND due_at <= ? AND status NOT IN ('COMPLETED', 'CANCELLED', 'EXCEPTION')",
  )
    .bind(now, now)
    .run();
}
