const DISCOVERY_PATHS = new Set([
  "/v1/value",
  "/v1/value/capabilities",
  "/.well-known/xguard/value-harvester.json",
]);
const OPPORTUNITIES_PATH = "/v1/value/opportunities";
const SUMMARY_PATH = "/v1/value/summary";

const OPPORTUNITY_KINDS = new Set([
  "refund",
  "service_credit",
  "fee_refund",
  "rebate",
  "overcharge",
  "duplicate_charge",
  "settlement_shortfall",
  "reward",
  "bounty",
  "commission",
  "cashback",
  "contractual_credit",
  "unclaimed_balance",
  "other",
]);

const ALLOWED_TRANSITIONS: Record<string, ReadonlySet<string>> = {
  FOUND: new Set(["ELIGIBLE", "REVIEW", "REJECTED", "EXPIRED"]),
  ELIGIBLE: new Set(["CLAIMING", "REVIEW", "REJECTED", "EXPIRED"]),
  REVIEW: new Set(["ELIGIBLE", "REJECTED", "EXPIRED"]),
  CLAIMING: new Set(["CLAIMED", "FAILED", "REVIEW"]),
  CLAIMED: new Set(["RECOVERED", "FAILED", "REVIEW"]),
  FAILED: new Set(["CLAIMING", "REVIEW", "REJECTED", "EXPIRED"]),
  RECOVERED: new Set(),
  REJECTED: new Set(),
  EXPIRED: new Set(),
};

interface ValueHarvesterEnv {
  DB: D1Database;
  XGUARD_VALUE_API_KEY?: string;
}

interface OpportunityInput {
  source?: unknown;
  kind?: unknown;
  currency?: unknown;
  grossValue?: unknown;
  estimatedCost?: unknown;
  confidence?: unknown;
  expiresAt?: unknown;
  automatic?: unknown;
  rightToClaim?: unknown;
  termsConfirmed?: unknown;
  legalBasis?: unknown;
  evidence?: unknown;
  claim?: unknown;
  metadata?: unknown;
}

interface NormalizedOpportunity {
  id: string;
  source: string;
  kind: string;
  currency: string;
  grossMicros: number;
  costMicros: number;
  netMicros: number;
  confidence: number;
  expiresAt: string | null;
  automatic: boolean;
  rightToClaim: boolean;
  termsConfirmed: boolean;
  legalBasis: string;
  evidence: string[];
  claim: Record<string, unknown> | null;
  metadata: Record<string, unknown> | null;
  eligible: boolean;
  status: "ELIGIBLE" | "REVIEW" | "REJECTED";
  reasons: string[];
}

export async function valueHarvesterResponse(
  request: Request,
  env: ValueHarvesterEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    DISCOVERY_PATHS.has(url.pathname) &&
    (request.method === "GET" || request.method === "HEAD")
  ) {
    return discoveryResponse(request, url.origin);
  }

  if (url.pathname === OPPORTUNITIES_PATH) {
    if (request.method === "OPTIONS") return corsPreflight();
    const auth = authorize(request, env);
    if (auth) return auth;
    await ensureSchema(env.DB);

    if (request.method === "POST") return ingestOpportunity(request, env.DB);
    if (request.method === "GET" || request.method === "HEAD") {
      return listOpportunities(request, env.DB, url);
    }
    return methodNotAllowed("GET, HEAD, POST, OPTIONS");
  }

  if (url.pathname === SUMMARY_PATH) {
    if (request.method === "OPTIONS") return corsPreflight();
    const auth = authorize(request, env);
    if (auth) return auth;
    await ensureSchema(env.DB);

    if (request.method === "GET" || request.method === "HEAD") {
      return summaryResponse(request, env.DB);
    }
    return methodNotAllowed("GET, HEAD, OPTIONS");
  }

  const transitionMatch = url.pathname.match(
    /^\/v1\/value\/opportunities\/([A-Za-z0-9_-]{8,128})\/transition$/,
  );
  const opportunityId = transitionMatch?.[1];
  if (opportunityId) {
    if (request.method === "OPTIONS") return corsPreflight();
    const auth = authorize(request, env);
    if (auth) return auth;
    await ensureSchema(env.DB);

    if (request.method !== "POST") return methodNotAllowed("POST, OPTIONS");
    return transitionOpportunity(request, env.DB, opportunityId);
  }

  return null;
}

function authorize(request: Request, env: ValueHarvesterEnv): Response | null {
  const configured = env.XGUARD_VALUE_API_KEY?.trim();
  if (!configured) {
    return jsonResponse(
      {
        error: "value_harvester_not_configured",
        message: "Set XGUARD_VALUE_API_KEY before exposing private value data.",
      },
      503,
    );
  }

  const actual = request.headers.get("authorization") ?? "";
  const expected = `Bearer ${configured}`;
  if (!constantTimeEqual(actual, expected)) {
    return jsonResponse({ error: "unauthorized" }, 401, {
      "WWW-Authenticate": 'Bearer realm="xguard-value"',
    });
  }
  return null;
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

async function ensureSchema(db: D1Database): Promise<void> {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS value_opportunities (
      id TEXT PRIMARY KEY,
      source TEXT NOT NULL,
      kind TEXT NOT NULL,
      currency TEXT NOT NULL,
      gross_micros INTEGER NOT NULL,
      cost_micros INTEGER NOT NULL,
      net_micros INTEGER NOT NULL,
      confidence REAL NOT NULL,
      expires_at TEXT,
      automatic INTEGER NOT NULL,
      right_to_claim INTEGER NOT NULL,
      terms_confirmed INTEGER NOT NULL,
      legal_basis TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      claim_json TEXT,
      metadata_json TEXT,
      eligible INTEGER NOT NULL,
      status TEXT NOT NULL,
      reasons_json TEXT NOT NULL,
      recovered_micros INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_value_opportunities_status
      ON value_opportunities(status, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_value_opportunities_source
      ON value_opportunities(source, updated_at DESC);
  `);
}

async function ingestOpportunity(
  request: Request,
  db: D1Database,
): Promise<Response> {
  let input: OpportunityInput;
  try {
    input = (await request.json()) as OpportunityInput;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const normalized = normalizeOpportunity(input);
  if ("error" in normalized) {
    return jsonResponse(
      { error: "invalid_opportunity", details: normalized.error },
      400,
    );
  }

  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO value_opportunities (
        id, source, kind, currency, gross_micros, cost_micros, net_micros,
        confidence, expires_at, automatic, right_to_claim, terms_confirmed,
        legal_basis, evidence_json, claim_json, metadata_json, eligible, status,
        reasons_json, recovered_micros, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
    )
    .bind(
      normalized.id,
      normalized.source,
      normalized.kind,
      normalized.currency,
      normalized.grossMicros,
      normalized.costMicros,
      normalized.netMicros,
      normalized.confidence,
      normalized.expiresAt,
      normalized.automatic ? 1 : 0,
      normalized.rightToClaim ? 1 : 0,
      normalized.termsConfirmed ? 1 : 0,
      normalized.legalBasis,
      JSON.stringify(normalized.evidence),
      normalized.claim ? JSON.stringify(normalized.claim) : null,
      normalized.metadata ? JSON.stringify(normalized.metadata) : null,
      normalized.eligible ? 1 : 0,
      normalized.status,
      JSON.stringify(normalized.reasons),
      now,
      now,
    )
    .run();

  return jsonResponse(
    {
      id: normalized.id,
      status: normalized.status,
      eligible: normalized.eligible,
      source: normalized.source,
      kind: normalized.kind,
      currency: normalized.currency,
      grossValue: microsToAmount(normalized.grossMicros),
      estimatedCost: microsToAmount(normalized.costMicros),
      expectedNetValue: microsToAmount(normalized.netMicros),
      confidence: normalized.confidence,
      automatic: normalized.automatic,
      reasons: normalized.reasons,
    },
    201,
  );
}

function normalizeOpportunity(
  input: OpportunityInput,
): NormalizedOpportunity | { error: string[] } {
  const errors: string[] = [];
  const source = readText(input.source, 200);
  const kind = readText(input.kind, 64).toLowerCase();
  const currency = readText(input.currency, 12).toUpperCase();
  const legalBasis = readText(input.legalBasis, 500);
  const evidence = readStringArray(input.evidence, 20, 1000);
  const grossMicros = amountToMicros(input.grossValue);
  const costMicros =
    input.estimatedCost === undefined ? 0 : amountToMicros(input.estimatedCost);
  const confidence = readConfidence(input.confidence);
  const expiresAt = readIsoDate(input.expiresAt);
  const claim = readRecord(input.claim);
  const metadata = readRecord(input.metadata);

  if (!source) errors.push("source is required");
  if (!OPPORTUNITY_KINDS.has(kind)) errors.push("kind is not supported");
  if (!/^[A-Z]{3,12}$/.test(currency)) errors.push("currency is invalid");
  if (!legalBasis) errors.push("legalBasis is required");
  if (grossMicros === null || grossMicros <= 0) {
    errors.push("grossValue must be a positive finite amount");
  }
  if (costMicros === null || costMicros < 0) {
    errors.push("estimatedCost must be zero or a positive finite amount");
  }
  if (confidence === null) errors.push("confidence must be between 0 and 1");
  if (input.expiresAt !== undefined && expiresAt === null) {
    errors.push("expiresAt must be an ISO-8601 date/time");
  }
  if (input.claim !== undefined && input.claim !== null && claim === null) {
    errors.push("claim must be an object when provided");
  }
  if (
    input.metadata !== undefined &&
    input.metadata !== null &&
    metadata === null
  ) {
    errors.push("metadata must be an object when provided");
  }

  if (
    errors.length > 0 ||
    grossMicros === null ||
    costMicros === null ||
    confidence === null
  ) {
    return { error: errors };
  }

  const netMicros = grossMicros - costMicros;
  const rightToClaim = input.rightToClaim === true;
  const termsConfirmed = input.termsConfirmed === true;
  const automatic = input.automatic === true;
  const reasons: string[] = [];

  if (!rightToClaim) reasons.push("right_to_claim_not_confirmed");
  if (!termsConfirmed) reasons.push("program_or_contract_terms_not_confirmed");
  if (evidence.length === 0) reasons.push("no_supporting_evidence");
  if (netMicros <= 0) reasons.push("non_positive_expected_net_value");
  if (confidence < 0.65) reasons.push("confidence_below_0_65");
  if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
    reasons.push("opportunity_expired");
  }

  const hardReject = reasons.some((reason) =>
    [
      "right_to_claim_not_confirmed",
      "program_or_contract_terms_not_confirmed",
      "non_positive_expected_net_value",
      "opportunity_expired",
    ].includes(reason),
  );
  const eligible = reasons.length === 0;
  const status: "ELIGIBLE" | "REVIEW" | "REJECTED" = eligible
    ? "ELIGIBLE"
    : hardReject
      ? "REJECTED"
      : "REVIEW";

  return {
    id: `xgv_${crypto.randomUUID().replaceAll("-", "")}`,
    source,
    kind,
    currency,
    grossMicros,
    costMicros,
    netMicros,
    confidence,
    expiresAt,
    automatic,
    rightToClaim,
    termsConfirmed,
    legalBasis,
    evidence,
    claim,
    metadata,
    eligible,
    status,
    reasons,
  };
}

async function listOpportunities(
  request: Request,
  db: D1Database,
  url: URL,
): Promise<Response> {
  const parsedLimit = Number(url.searchParams.get("limit") ?? "50");
  const limit = Number.isFinite(parsedLimit)
    ? Math.max(1, Math.min(200, Math.trunc(parsedLimit)))
    : 50;
  const status = (url.searchParams.get("status") ?? "").toUpperCase();

  const statement = status
    ? db
        .prepare(
          "SELECT * FROM value_opportunities WHERE status = ? ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(status, limit)
    : db
        .prepare(
          "SELECT * FROM value_opportunities ORDER BY updated_at DESC LIMIT ?",
        )
        .bind(limit);

  const result = await statement.all<Record<string, unknown>>();
  const opportunities = (result.results ?? []).map(serializeRow);
  return new Response(
    request.method === "HEAD" ? null : JSON.stringify({ opportunities }),
    { status: 200, headers: jsonHeaders() },
  );
}

async function summaryResponse(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const row = await db
    .prepare(
      `SELECT
        COUNT(*) AS found_count,
        SUM(CASE WHEN status IN ('ELIGIBLE','CLAIMING','CLAIMED','RECOVERED') THEN 1 ELSE 0 END) AS eligible_count,
        SUM(CASE WHEN status IN ('CLAIMED','RECOVERED') THEN 1 ELSE 0 END) AS claimed_count,
        SUM(CASE WHEN status = 'RECOVERED' THEN 1 ELSE 0 END) AS recovered_count,
        COALESCE(SUM(CASE WHEN status IN ('ELIGIBLE','CLAIMING','CLAIMED','RECOVERED') THEN net_micros ELSE 0 END), 0) AS eligible_net_micros,
        COALESCE(SUM(recovered_micros), 0) AS recovered_micros
      FROM value_opportunities`,
    )
    .first<Record<string, unknown>>();

  const body = {
    found: Number(row?.found_count ?? 0),
    eligible: Number(row?.eligible_count ?? 0),
    claimed: Number(row?.claimed_count ?? 0),
    recovered: Number(row?.recovered_count ?? 0),
    eligibleExpectedNetValue: microsToAmount(
      Number(row?.eligible_net_micros ?? 0),
    ),
    recoveredValue: microsToAmount(Number(row?.recovered_micros ?? 0)),
    unit: "currency-specific; mixed currencies require normalization",
  };

  return new Response(request.method === "HEAD" ? null : JSON.stringify(body), {
    status: 200,
    headers: jsonHeaders(),
  });
}

async function transitionOpportunity(
  request: Request,
  db: D1Database,
  id: string,
): Promise<Response> {
  let input: Record<string, unknown>;
  try {
    input = (await request.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const target = readText(input.status, 32).toUpperCase();
  if (!target) return jsonResponse({ error: "status_required" }, 400);

  const current = await db
    .prepare(
      "SELECT status, currency, recovered_micros FROM value_opportunities WHERE id = ?",
    )
    .bind(id)
    .first<Record<string, unknown>>();
  if (!current) return jsonResponse({ error: "opportunity_not_found" }, 404);

  const currentStatus = String(current.status ?? "").toUpperCase();
  const allowed = ALLOWED_TRANSITIONS[currentStatus];
  if (!allowed?.has(target)) {
    return jsonResponse(
      {
        error: "invalid_status_transition",
        currentStatus,
        requestedStatus: target,
        allowed: allowed ? [...allowed] : [],
      },
      409,
    );
  }

  let recoveredMicros = Number(current.recovered_micros ?? 0);
  if (target === "RECOVERED") {
    const parsed = amountToMicros(input.recoveredValue);
    if (parsed === null || parsed < 0) {
      return jsonResponse(
        { error: "recoveredValue must be zero or a positive finite amount" },
        400,
      );
    }
    recoveredMicros = parsed;
  }

  const updatedAt = new Date().toISOString();
  await db
    .prepare(
      "UPDATE value_opportunities SET status = ?, recovered_micros = ?, updated_at = ? WHERE id = ?",
    )
    .bind(target, recoveredMicros, updatedAt, id)
    .run();

  return jsonResponse({
    id,
    status: target,
    currency: current.currency,
    recoveredValue: microsToAmount(recoveredMicros),
    updatedAt,
  });
}

function serializeRow(row: Record<string, unknown>): Record<string, unknown> {
  return {
    id: row.id,
    source: row.source,
    kind: row.kind,
    currency: row.currency,
    grossValue: microsToAmount(Number(row.gross_micros ?? 0)),
    estimatedCost: microsToAmount(Number(row.cost_micros ?? 0)),
    expectedNetValue: microsToAmount(Number(row.net_micros ?? 0)),
    confidence: Number(row.confidence ?? 0),
    expiresAt: row.expires_at,
    automatic: Number(row.automatic ?? 0) === 1,
    rightToClaim: Number(row.right_to_claim ?? 0) === 1,
    termsConfirmed: Number(row.terms_confirmed ?? 0) === 1,
    legalBasis: row.legal_basis,
    evidence: parseJson(row.evidence_json, []),
    claim: parseJson(row.claim_json, null),
    metadata: parseJson(row.metadata_json, null),
    eligible: Number(row.eligible ?? 0) === 1,
    status: row.status,
    reasons: parseJson(row.reasons_json, []),
    recoveredValue: microsToAmount(Number(row.recovered_micros ?? 0)),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function discoveryResponse(request: Request, origin: string): Response {
  const body = {
    name: "XGuard Value Harvester",
    version: 1,
    category: "universal-value-recovery",
    description:
      "Hosted engine for discovering, qualifying, proving, claiming and reconciling legally recoverable value.",
    localInstallRequired: false,
    custody: false,
    pipeline: ["DISCOVER", "QUALIFY", "PROVE", "CLAIM", "RECONCILE"],
    opportunityKinds: [...OPPORTUNITY_KINDS],
    api: {
      ingest: `${origin}${OPPORTUNITIES_PATH}`,
      list: `${origin}${OPPORTUNITIES_PATH}`,
      summary: `${origin}${SUMMARY_PATH}`,
      transition: `${origin}${OPPORTUNITIES_PATH}/{id}/transition`,
    },
    counters: ["found", "eligible", "claimed", "recovered"],
    safety: {
      noUnauthorizedFunds: true,
      confirmedRightRequired: true,
      confirmedTermsRequired: true,
      evidenceRequiredForEligibility: true,
      privateOpportunityDataRequiresBearerToken: true,
    },
    connectorModel: {
      openEnded: true,
      examples: [
        "cloud-service-credit",
        "refund",
        "rebate",
        "overcharge-recovery",
        "duplicate-charge-recovery",
        "settlement-shortfall",
        "reward",
        "bounty",
        "commission",
        "unclaimed-balance",
        "x402-recovery",
      ],
      note: "x402 is one optional connector; the core does not depend on it.",
    },
  };

  return new Response(
    request.method === "HEAD" ? null : JSON.stringify(body, null, 2),
    {
      status: 200,
      headers: { ...jsonHeaders(), "Cache-Control": "public, max-age=300" },
    },
  );
}

function amountToMicros(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const micros = Math.round(value * 1_000_000);
  return Number.isSafeInteger(micros) ? micros : null;
}

function microsToAmount(micros: number): number {
  return Number((micros / 1_000_000).toFixed(6));
}

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function readStringArray(
  value: unknown,
  maxItems: number,
  maxLength: number,
): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim().slice(0, maxLength))
    .filter(Boolean);
}

function readConfidence(value: unknown): number | null {
  if (value === undefined) return 0.5;
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value >= 0 && value <= 1 ? value : null;
}

function readIsoDate(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function readRecord(value: unknown): Record<string, unknown> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function parseJson(value: unknown, fallback: unknown): unknown {
  if (typeof value !== "string") return fallback;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return fallback;
  }
}

function methodNotAllowed(allow: string): Response {
  return jsonResponse({ error: "method_not_allowed" }, 405, { Allow: allow });
}

function corsPreflight(): Response {
  return new Response(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Authorization, Content-Type",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
      "Access-Control-Max-Age": "86400",
    },
  });
}

function jsonHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  };
}

function jsonResponse(
  body: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders(), ...extraHeaders },
  });
}
