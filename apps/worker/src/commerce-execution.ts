const MAX_BODY_BYTES = 128 * 1024;
const MAX_EXECUTIONS_PER_TICK = 5;
const CALLBACK_MAX_AGE_SECONDS = 300;

export interface CommerceExecutionEnv {
  DB: D1Database;
  XGUARD_ADMIN_TOKEN_SHA256?: string;
  XGUARD_COMMERCE_EXECUTION_URL?: string;
  XGUARD_COMMERCE_EXECUTION_SECRET?: string;
  XGUARD_COMMERCE_VERIFICATION_SECRET?: string;
  XGUARD_COMMERCE_AUTO_EXECUTE?: string;
}

interface OpportunityExecutionRow {
  opportunity_id: string;
  product_key: string;
  quantity: number;
  revenue_usd: number;
  landed_cost_usd: number;
  reserve_usd: number;
  net_profit_usd: number;
  margin_bps: number;
  score: number;
  payment_before_purchase: number;
  sanctions_clear: number;
  restricted_goods_clear: number;
  identity_match: number;
  status: string;
  demand_source_url: string;
  supplier_source_url: string;
  buyer_payment_secured?: number | null;
  buyer_funds_available?: number | null;
  buyer_identity_verified?: number | null;
  supplier_identity_verified?: number | null;
  supplier_inventory_verified?: number | null;
}

interface ExecutionRow {
  execution_id: string;
  opportunity_id: string;
  idempotency_key: string;
  state: string;
  attempts: number;
  connector_ref?: string | null;
  expected_revenue_usd: number;
  expected_cost_usd: number;
  expected_profit_usd: number;
  actual_revenue_usd?: number | null;
  actual_cost_usd?: number | null;
  actual_profit_usd?: number | null;
  last_error?: string | null;
}

interface VerificationPayload {
  opportunityId?: string;
  buyerPaymentSecured?: boolean;
  buyerFundsAvailableBeforePurchase?: boolean;
  buyerIdentityVerified?: boolean;
  supplierIdentityVerified?: boolean;
  supplierInventoryVerified?: boolean;
  evidence?: Record<string, unknown>;
}

interface ConfirmationPayload {
  eventId?: string;
  executionId?: string;
  state?: string;
  connectorRef?: string;
  actualRevenueUsd?: number;
  actualCostUsd?: number;
  actualProfitUsd?: number;
  detail?: Record<string, unknown>;
}

export async function commerceExecutionResponse(
  request: Request,
  env: CommerceExecutionEnv,
): Promise<Response | null> {
  const url = new URL(request.url);

  if (
    request.method === "GET" &&
    url.pathname === "/v1/commerce/execution/status"
  ) {
    return executionStatus(env);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/commerce/verifications"
  ) {
    const raw = await readBody(request);
    if (raw === null) return json({ error: "body_too_large" }, 413);
    if (
      !(await verifySignedRequest(
        request,
        raw,
        env.XGUARD_COMMERCE_VERIFICATION_SECRET,
      ))
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    const payload = parseJson<VerificationPayload>(raw);
    if (!payload) return json({ error: "invalid_json" }, 400);
    return upsertVerification(env, payload);
  }

  if (
    request.method === "POST" &&
    url.pathname === "/v1/commerce/executions/confirm"
  ) {
    const raw = await readBody(request);
    if (raw === null) return json({ error: "body_too_large" }, 413);
    if (
      !(await verifySignedRequest(
        request,
        raw,
        env.XGUARD_COMMERCE_EXECUTION_SECRET,
      ))
    ) {
      return json({ error: "unauthorized" }, 401);
    }
    const payload = parseJson<ConfirmationPayload>(raw);
    if (!payload) return json({ error: "invalid_json" }, 400);
    return confirmExecution(env, payload);
  }

  const verifyMatch = url.pathname.match(
    /^\/v1\/commerce\/opportunities\/([^/]+)\/verify$/,
  );
  if (request.method === "POST" && verifyMatch) {
    if (!(await requireAdmin(request, env)))
      return json({ error: "unauthorized" }, 401);
    const raw = await readBody(request);
    if (raw === null) return json({ error: "body_too_large" }, 413);
    const payload = parseJson<VerificationPayload>(raw) ?? {};
    payload.opportunityId = decodeURIComponent(verifyMatch[1]);
    return upsertVerification(env, payload);
  }

  const executeMatch = url.pathname.match(
    /^\/v1\/commerce\/opportunities\/([^/]+)\/execute$/,
  );
  if (request.method === "POST" && executeMatch) {
    if (!(await requireAdmin(request, env)))
      return json({ error: "unauthorized" }, 401);
    const result = await executeOpportunity(
      env,
      decodeURIComponent(executeMatch[1]),
    );
    return json(result.body, result.status);
  }

  if (request.method === "GET" && url.pathname === "/v1/commerce/executions") {
    if (!(await requireAdmin(request, env)))
      return json({ error: "unauthorized" }, 401);
    const limit = boundedInt(url.searchParams.get("limit"), 50, 1, 200);
    const rows = await env.DB.prepare(
      `SELECT execution_id,opportunity_id,state,attempts,connector_ref,
              expected_revenue_usd,expected_cost_usd,expected_profit_usd,
              actual_revenue_usd,actual_cost_usd,actual_profit_usd,last_error,
              submitted_at,confirmed_at,created_at,updated_at
       FROM commerce_executions ORDER BY created_at DESC LIMIT ?`,
    )
      .bind(limit)
      .all<Record<string, unknown>>();
    return json({ executions: rows.results ?? [] });
  }

  return null;
}

export async function commerceExecutionScheduled(
  env: CommerceExecutionEnv,
): Promise<void> {
  if (!autoExecute(env) || !connectorConfigured(env)) return;
  const rows = await env.DB.prepare(
    `SELECT o.opportunity_id
       FROM commerce_opportunities o
       JOIN commerce_trade_verifications v ON v.opportunity_id=o.opportunity_id
       LEFT JOIN commerce_executions e ON e.opportunity_id=o.opportunity_id
      WHERE o.status='READY'
        AND o.payment_before_purchase=1
        AND o.sanctions_clear=1
        AND o.restricted_goods_clear=1
        AND o.identity_match=1
        AND v.buyer_payment_secured=1
        AND v.buyer_funds_available=1
        AND v.buyer_identity_verified=1
        AND v.supplier_identity_verified=1
        AND v.supplier_inventory_verified=1
        AND (e.execution_id IS NULL OR e.state='FAILED')
      ORDER BY o.score DESC,o.net_profit_usd DESC
      LIMIT ?`,
  )
    .bind(MAX_EXECUTIONS_PER_TICK)
    .all<{ opportunity_id: string }>();

  for (const row of rows.results ?? []) {
    await executeOpportunity(env, row.opportunity_id);
  }
}

async function executionStatus(env: CommerceExecutionEnv): Promise<Response> {
  const row = await env.DB.prepare(
    `SELECT
       (SELECT COUNT(*) FROM commerce_trade_verifications
         WHERE buyer_payment_secured=1 AND buyer_funds_available=1
           AND buyer_identity_verified=1 AND supplier_identity_verified=1
           AND supplier_inventory_verified=1) AS verified,
       (SELECT COUNT(*) FROM commerce_executions WHERE state='SUBMITTED') AS submitted,
       (SELECT COUNT(*) FROM commerce_executions WHERE state='CONFIRMED') AS confirmed,
       (SELECT COUNT(*) FROM commerce_executions WHERE state='FAILED') AS failed,
       (SELECT COALESCE(SUM(actual_profit_usd),0) FROM commerce_executions WHERE state='CONFIRMED') AS realized_profit_usd`,
  ).first<Record<string, unknown>>();
  return json({
    mode: "verified-execution",
    connectorConfigured: connectorConfigured(env),
    autoExecute: autoExecute(env),
    counts: row ?? {},
  });
}

async function upsertVerification(
  env: CommerceExecutionEnv,
  payload: VerificationPayload,
): Promise<Response> {
  const opportunityId = clean(payload.opportunityId, 200);
  if (!opportunityId) return json({ error: "opportunity_id_required" }, 400);
  const exists = await env.DB.prepare(
    "SELECT opportunity_id FROM commerce_opportunities WHERE opportunity_id=?",
  )
    .bind(opportunityId)
    .first<{ opportunity_id: string }>();
  if (!exists) return json({ error: "opportunity_not_found" }, 404);

  const values = {
    buyerPaymentSecured: payload.buyerPaymentSecured === true,
    buyerFundsAvailable: payload.buyerFundsAvailableBeforePurchase === true,
    buyerIdentityVerified: payload.buyerIdentityVerified === true,
    supplierIdentityVerified: payload.supplierIdentityVerified === true,
    supplierInventoryVerified: payload.supplierInventoryVerified === true,
  };
  const fullyVerified = Object.values(values).every(Boolean);
  const now = new Date().toISOString();
  const evidence = safeJson(payload.evidence ?? {});
  await env.DB.prepare(
    `INSERT INTO commerce_trade_verifications(
       opportunity_id,buyer_payment_secured,buyer_funds_available,buyer_identity_verified,
       supplier_identity_verified,supplier_inventory_verified,evidence_json,verified_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?)
     ON CONFLICT(opportunity_id) DO UPDATE SET
       buyer_payment_secured=excluded.buyer_payment_secured,
       buyer_funds_available=excluded.buyer_funds_available,
       buyer_identity_verified=excluded.buyer_identity_verified,
       supplier_identity_verified=excluded.supplier_identity_verified,
       supplier_inventory_verified=excluded.supplier_inventory_verified,
       evidence_json=excluded.evidence_json,
       verified_at=excluded.verified_at,
       updated_at=excluded.updated_at`,
  )
    .bind(
      opportunityId,
      values.buyerPaymentSecured ? 1 : 0,
      values.buyerFundsAvailable ? 1 : 0,
      values.buyerIdentityVerified ? 1 : 0,
      values.supplierIdentityVerified ? 1 : 0,
      values.supplierInventoryVerified ? 1 : 0,
      evidence,
      fullyVerified ? now : null,
      now,
    )
    .run();
  return json(
    { accepted: true, opportunityId, fullyVerified },
    fullyVerified ? 200 : 202,
  );
}

async function executeOpportunity(
  env: CommerceExecutionEnv,
  opportunityId: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!connectorConfigured(env)) {
    return {
      status: 503,
      body: { error: "execution_connector_not_configured" },
    };
  }

  const row = await env.DB.prepare(
    `SELECT o.*,
            d.source_url AS demand_source_url,
            s.source_url AS supplier_source_url,
            v.buyer_payment_secured,v.buyer_funds_available,v.buyer_identity_verified,
            v.supplier_identity_verified,v.supplier_inventory_verified
       FROM commerce_opportunities o
       JOIN commerce_demands d ON d.demand_id=o.demand_id
       JOIN commerce_offers s ON s.offer_id=o.offer_id
       LEFT JOIN commerce_trade_verifications v ON v.opportunity_id=o.opportunity_id
      WHERE o.opportunity_id=?`,
  )
    .bind(opportunityId)
    .first<OpportunityExecutionRow>();
  if (!row) return { status: 404, body: { error: "opportunity_not_found" } };

  const eligibility = executionEligibility(row);
  if (!eligibility.ok) {
    return {
      status: 409,
      body: { error: "execution_not_eligible", reasons: eligibility.reasons },
    };
  }

  const existing = await env.DB.prepare(
    "SELECT * FROM commerce_executions WHERE opportunity_id=?",
  )
    .bind(opportunityId)
    .first<ExecutionRow>();
  if (existing?.state === "CONFIRMED" || existing?.state === "SUBMITTED") {
    return {
      status: 200,
      body: {
        accepted: true,
        duplicate: true,
        executionId: existing.execution_id,
        state: existing.state,
        connectorRef: existing.connector_ref ?? null,
      },
    };
  }

  const executionId = existing?.execution_id ?? crypto.randomUUID();
  const idempotencyKey = existing?.idempotency_key ?? `xguard:${opportunityId}`;
  const attempts = Number(existing?.attempts ?? 0) + 1;
  if (attempts > 5)
    return { status: 409, body: { error: "execution_attempt_limit_reached" } };
  const now = new Date().toISOString();

  if (!existing) {
    await env.DB.prepare(
      `INSERT INTO commerce_executions(
         execution_id,opportunity_id,idempotency_key,state,attempts,
         expected_revenue_usd,expected_cost_usd,expected_profit_usd,created_at,updated_at)
       VALUES(?,?,?,'QUEUED',?,?,?,?,?,?)`,
    )
      .bind(
        executionId,
        opportunityId,
        idempotencyKey,
        attempts,
        row.revenue_usd,
        row.landed_cost_usd + row.reserve_usd,
        row.net_profit_usd,
        now,
        now,
      )
      .run();
  } else {
    await env.DB.prepare(
      "UPDATE commerce_executions SET state='QUEUED',attempts=?,last_error=NULL,updated_at=? WHERE execution_id=?",
    )
      .bind(attempts, now, executionId)
      .run();
  }

  const payload = {
    version: 1,
    executionId,
    opportunityId,
    idempotencyKey,
    productKey: row.product_key,
    quantity: row.quantity,
    expected: {
      revenueUsd: row.revenue_usd,
      landedCostUsd: row.landed_cost_usd,
      reserveUsd: row.reserve_usd,
      profitUsd: row.net_profit_usd,
      marginBps: row.margin_bps,
    },
    evidence: {
      demandSourceUrl: row.demand_source_url,
      supplierSourceUrl: row.supplier_source_url,
    },
  };
  const raw = JSON.stringify(payload);

  try {
    const target = safeHttpsUrl(env.XGUARD_COMMERCE_EXECUTION_URL);
    if (!target) throw new Error("unsafe_execution_url");
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const signature = await hmacHex(
      env.XGUARD_COMMERCE_EXECUTION_SECRET ?? "",
      `${timestamp}.${raw}`,
    );
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);
    let response: Response;
    try {
      response = await fetch(target, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "user-agent": "XGuard-Commerce-Execution/1.0",
          "x-xguard-timestamp": timestamp,
          "x-xguard-signature": `sha256=${signature}`,
          "x-idempotency-key": idempotencyKey,
        },
        body: raw,
        redirect: "error",
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }
    const text = (await response.text()).slice(0, 20_000);
    const parsed = parseJson<Record<string, unknown>>(text) ?? {};
    if (!response.ok || parsed.accepted !== true) {
      throw new Error(
        `connector_rejected_${response.status}:${clean(text, 500)}`,
      );
    }
    const connectorRef = clean(parsed.executionRef, 300) || null;
    await env.DB.prepare(
      `UPDATE commerce_executions
          SET state='SUBMITTED',connector_ref=?,submitted_at=?,updated_at=?
        WHERE execution_id=?`,
    )
      .bind(connectorRef, now, now, executionId)
      .run();
    await recordEvent(
      env,
      executionId,
      `submitted:${executionId}:${attempts}`,
      "SUBMITTED",
      {
        connectorRef,
        httpStatus: response.status,
      },
    );
    return {
      status: 202,
      body: { accepted: true, executionId, state: "SUBMITTED", connectorRef },
    };
  } catch (error) {
    const message = clean(
      error instanceof Error ? error.message : String(error),
      1000,
    );
    await env.DB.prepare(
      "UPDATE commerce_executions SET state='FAILED',last_error=?,updated_at=? WHERE execution_id=?",
    )
      .bind(message, new Date().toISOString(), executionId)
      .run();
    await recordEvent(
      env,
      executionId,
      `failed:${executionId}:${attempts}`,
      "FAILED",
      { error: message },
    );
    return {
      status: 502,
      body: { error: "execution_failed", detail: message, executionId },
    };
  }
}

function executionEligibility(row: OpportunityExecutionRow): {
  ok: boolean;
  reasons: string[];
} {
  const reasons: string[] = [];
  if (row.status !== "READY") reasons.push("opportunity_not_ready");
  if (row.payment_before_purchase !== 1)
    reasons.push("commercial_payment_terms_not_pre_funded");
  if (row.sanctions_clear !== 1)
    reasons.push("jurisdiction_or_sanctions_gate_failed");
  if (row.restricted_goods_clear !== 1)
    reasons.push("restricted_goods_gate_failed");
  if (row.identity_match !== 1) reasons.push("product_identity_mismatch");
  if (row.buyer_payment_secured !== 1)
    reasons.push("buyer_payment_not_verified");
  if (row.buyer_funds_available !== 1)
    reasons.push("buyer_funds_not_verified_available");
  if (row.buyer_identity_verified !== 1)
    reasons.push("buyer_identity_not_verified");
  if (row.supplier_identity_verified !== 1)
    reasons.push("supplier_identity_not_verified");
  if (row.supplier_inventory_verified !== 1)
    reasons.push("supplier_inventory_not_verified");
  return { ok: reasons.length === 0, reasons };
}

async function confirmExecution(
  env: CommerceExecutionEnv,
  payload: ConfirmationPayload,
): Promise<Response> {
  const eventId = clean(payload.eventId, 300);
  const executionId = clean(payload.executionId, 200);
  if (!eventId || !executionId)
    return json({ error: "event_id_and_execution_id_required" }, 400);
  const state = clean(payload.state, 80).toUpperCase();
  if (!new Set(["CONFIRMED", "FAILED", "CANCELLED"]).has(state)) {
    return json({ error: "invalid_state" }, 400);
  }

  const execution = await env.DB.prepare(
    "SELECT * FROM commerce_executions WHERE execution_id=?",
  )
    .bind(executionId)
    .first<ExecutionRow>();
  if (!execution) return json({ error: "execution_not_found" }, 404);
  const priorEvent = await env.DB.prepare(
    "SELECT event_id FROM commerce_execution_events WHERE event_id=?",
  )
    .bind(eventId)
    .first<{ event_id: string }>();
  if (priorEvent)
    return json({
      accepted: true,
      duplicate: true,
      executionId,
      state: execution.state,
    });

  const now = new Date().toISOString();
  const actualRevenue = finiteNonNegative(payload.actualRevenueUsd);
  const actualCost = finiteNonNegative(payload.actualCostUsd);
  let actualProfit = finiteNumber(payload.actualProfitUsd);
  if (actualProfit === null && actualRevenue !== null && actualCost !== null) {
    actualProfit = round2(actualRevenue - actualCost);
  }
  if (state === "CONFIRMED" && actualProfit === null) {
    return json(
      {
        error: "confirmed_execution_requires_actual_profit_or_revenue_and_cost",
      },
      400,
    );
  }
  const connectorRef =
    clean(payload.connectorRef, 300) || execution.connector_ref || null;
  const lastError =
    state === "FAILED"
      ? clean(payload.detail?.error, 1000) || "connector_reported_failure"
      : null;

  await env.DB.prepare(
    `UPDATE commerce_executions
        SET state=?,connector_ref=?,actual_revenue_usd=?,actual_cost_usd=?,actual_profit_usd=?,
            last_error=?,confirmed_at=?,updated_at=?
      WHERE execution_id=?`,
  )
    .bind(
      state,
      connectorRef,
      actualRevenue,
      actualCost,
      actualProfit,
      lastError,
      state === "CONFIRMED" ? now : null,
      now,
      executionId,
    )
    .run();
  await recordEvent(env, executionId, eventId, state, payload.detail ?? {});
  return json({
    accepted: true,
    executionId,
    state,
    actualProfitUsd: actualProfit,
  });
}

async function recordEvent(
  env: CommerceExecutionEnv,
  executionId: string,
  eventId: string,
  eventType: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await env.DB.prepare(
    `INSERT OR IGNORE INTO commerce_execution_events(event_id,execution_id,event_type,detail_json,created_at)
     VALUES(?,?,?,?,?)`,
  )
    .bind(
      eventId,
      executionId,
      eventType,
      safeJson(detail),
      new Date().toISOString(),
    )
    .run();
}

function connectorConfigured(env: CommerceExecutionEnv): boolean {
  return Boolean(
    safeHttpsUrl(env.XGUARD_COMMERCE_EXECUTION_URL) &&
    clean(env.XGUARD_COMMERCE_EXECUTION_SECRET, 1000),
  );
}

function autoExecute(env: CommerceExecutionEnv): boolean {
  if (!connectorConfigured(env)) return false;
  const value = clean(env.XGUARD_COMMERCE_AUTO_EXECUTE, 20).toLowerCase();
  return !["0", "false", "off", "no"].includes(value);
}

async function requireAdmin(
  request: Request,
  env: CommerceExecutionEnv,
): Promise<boolean> {
  const expected = clean(env.XGUARD_ADMIN_TOKEN_SHA256, 128).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(expected)) return false;
  const auth = request.headers.get("authorization") ?? "";
  const match = auth.match(/^Bearer\s+(.+)$/i);
  if (!match?.[1]) return false;
  const actual = await sha256Hex(match[1]);
  return constantTimeEqual(actual, expected);
}

async function verifySignedRequest(
  request: Request,
  raw: string,
  secretRaw: string | undefined,
): Promise<boolean> {
  const secret = clean(secretRaw, 2000);
  if (!secret) return false;
  const timestampRaw = request.headers.get("x-xguard-timestamp") ?? "";
  const signatureRaw = request.headers.get("x-xguard-signature") ?? "";
  const timestamp = Number(timestampRaw);
  if (!Number.isInteger(timestamp)) return false;
  if (
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) >
    CALLBACK_MAX_AGE_SECONDS
  )
    return false;
  const supplied = signatureRaw.replace(/^sha256=/i, "").toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(supplied)) return false;
  const expected = await hmacHex(secret, `${timestampRaw}.${raw}`);
  return constantTimeEqual(supplied, expected);
}

async function readBody(request: Request): Promise<string | null> {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(length) && length > MAX_BODY_BYTES) return null;
  const text = await request.text();
  if (new TextEncoder().encode(text).byteLength > MAX_BODY_BYTES) return null;
  return text;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(digest));
}

async function hmacHex(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(value),
  );
  return bytesToHex(new Uint8Array(signature));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join(
    "",
  );
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1)
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function safeHttpsUrl(raw: unknown): string | null {
  const value = clean(raw, 2000);
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    if (unsafeHost(host)) return null;
    return url.toString();
  } catch {
    return null;
  }
}

function unsafeHost(host: string): boolean {
  if (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.endsWith(".local")
  )
    return true;
  if (
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "::1" ||
    host === "[::1]"
  )
    return true;
  if (/^10\./.test(host) || /^192\.168\./.test(host)) return true;
  const match = host.match(/^172\.(\d+)\./);
  if (match && Number(match[1]) >= 16 && Number(match[1]) <= 31) return true;
  if (/^(fc|fd|fe80)/i.test(host.replace(/[\[\]]/g, ""))) return true;
  return false;
}

function parseJson<T>(raw: string): T | null {
  try {
    const parsed = JSON.parse(raw) as T;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value).slice(0, 20_000);
  } catch {
    return "{}";
  }
}

function boundedInt(
  raw: unknown,
  fallback: number,
  min: number,
  max: number,
): number {
  const number = Number(raw);
  return Number.isInteger(number)
    ? Math.max(min, Math.min(max, number))
    : fallback;
}

function finiteNonNegative(raw: unknown): number | null {
  const number = Number(raw);
  return Number.isFinite(number) && number >= 0 ? round2(number) : null;
}

function finiteNumber(raw: unknown): number | null {
  const number = Number(raw);
  return Number.isFinite(number) ? round2(number) : null;
}

function clean(raw: unknown, max = 500): string {
  return typeof raw === "string"
    ? raw
        .trim()
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .slice(0, max)
    : "";
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function json(body: Record<string, unknown>, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
