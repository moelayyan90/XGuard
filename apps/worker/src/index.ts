import { DurableObject } from "cloudflare:workers";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  SupportedResponse,
  VerifyResponse,
} from "@x402/core/types";
import {
  parsePaymentPayload,
  parsePaymentRequirements,
} from "@x402/core/schemas";
import {
  XGuardError,
  derivePaymentIdentities,
  isKnownTestnet,
  parseJsonStrict,
  parseUnsignedInteger,
  readHttpBodyTextCapped,
  sha256Hex,
} from "@xguard/core/edge";

type Env = Cloudflare.Env;
type Variables = { requestId: string };

const MAX_HTTP_BODY_BYTES = 64 * 1024;
const OUTBOX_INITIAL_DELAY_MS = 1_000;
const OUTBOX_RETRY_DELAY_MS = 60_000;
const SETTLEMENT_PREPARED_STALE_MS = 120_000;
const SETTLEMENT_STALE_MS = 120_000;
const CLIENT_CONCURRENCY_LIMIT = 4;
const CLIENT_LEASE_MS = 45_000;

interface FacilitatorConfig {
  id: string;
  baseUrl: string;
  networks: string[];
  schemes: string[];
  costMicroUsd: number;
  priority: number;
  exactEvmTransferMethods: ("eip3009" | "permit2")[];
}

interface CoordinatorPrepareInput {
  logicalPaymentKey: string;
  requestFingerprint: string;
  paymentIdentifier: string | null;
  network: string;
  testnet: boolean;
}

type CoordinatorPrepareResult =
  | { kind: "OWNER" }
  | { kind: "CACHED"; result: SettleResponse }
  | { kind: "FAILED"; result: SettleResponse }
  | { kind: "IN_PROGRESS" }
  | { kind: "AMBIGUOUS" }
  | { kind: "CONFLICT" };

interface SettlementProjectionEvent {
  eventId: string;
  logicalPaymentKey: string;
  requestFingerprint: string;
  paymentIdentifier: string | null;
  network: string;
  facilitatorId: string;
  state: "SETTLED" | "FAILED" | "AMBIGUOUS";
  transactionHash: string | null;
  testnet: boolean;
  feeMicroUsd: number;
  downstreamCostMicroUsd: number;
  recordedAt: string;
  reasonCode: string | null;
}

interface PaymentRow extends Record<string, SqlStorageValue> {
  logical_key: string;
  request_fingerprint: string;
  payment_identifier: string | null;
  network: string;
  testnet: number;
  state: string;
  facilitator_id: string | null;
  result_json: string | null;
}

interface OutboxRow extends Record<string, SqlStorageValue> {
  event_id: string;
  payload_json: string;
}

export class PaymentCoordinator extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS payment (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        logical_key TEXT NOT NULL UNIQUE,
        request_fingerprint TEXT NOT NULL,
        payment_identifier TEXT,
        network TEXT NOT NULL,
        testnet INTEGER NOT NULL CHECK (testnet IN (0,1)),
        state TEXT NOT NULL CHECK (state IN ('OUTBOUND_PREPARED','OUTBOUND_STARTED','SETTLED','FAILED','AMBIGUOUS')),
        facilitator_id TEXT,
        result_json TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS outbox (
        event_id TEXT PRIMARY KEY,
        payload_json TEXT NOT NULL,
        dispatched_at TEXT,
        attempts INTEGER NOT NULL DEFAULT 0,
        last_error_code TEXT
      );`);
    });
  }

  public async prepare(
    input: CoordinatorPrepareInput,
  ): Promise<CoordinatorPrepareResult> {
    this.recoverStalePrepared(Date.now());
    this.recoverStaleStarted(Date.now());
    const existing = this.payment();
    let result: CoordinatorPrepareResult;
    if (existing === null) {
      const now = new Date().toISOString();
      this.sql.exec(
        "INSERT INTO payment(singleton,logical_key,request_fingerprint,payment_identifier,network,testnet,state,created_at,updated_at) VALUES(1,?,?,?,?,?,'OUTBOUND_PREPARED',?,?)",
        input.logicalPaymentKey,
        input.requestFingerprint,
        input.paymentIdentifier,
        input.network,
        input.testnet ? 1 : 0,
        now,
        now,
      );
      result = { kind: "OWNER" };
    } else if (
      existing.logical_key !== input.logicalPaymentKey ||
      existing.request_fingerprint !== input.requestFingerprint
    ) {
      result = { kind: "CONFLICT" };
    } else if (existing.state === "SETTLED" && existing.result_json !== null) {
      result = {
        kind: "CACHED",
        result: JSON.parse(existing.result_json) as SettleResponse,
      };
    } else if (existing.state === "FAILED" && existing.result_json !== null) {
      result = {
        kind: "FAILED",
        result: JSON.parse(existing.result_json) as SettleResponse,
      };
    } else if (existing.state === "AMBIGUOUS") {
      result = { kind: "AMBIGUOUS" };
    } else {
      result = { kind: "IN_PROGRESS" };
    }
    await this.ensureRecoveryAlarm();
    return result;
  }

  public async start(facilitatorId: string): Promise<boolean> {
    const startedAt = Date.now();
    await this.scheduleNoLaterThan(startedAt + SETTLEMENT_STALE_MS);
    const cursor = this.sql.exec(
      "UPDATE payment SET state='OUTBOUND_STARTED', facilitator_id=?, updated_at=? WHERE singleton=1 AND state='OUTBOUND_PREPARED'",
      facilitatorId,
      new Date(startedAt).toISOString(),
    );
    if (cursor.rowsWritten !== 1) await this.ensureRecoveryAlarm();
    return cursor.rowsWritten === 1;
  }

  public async finalize(
    result: SettleResponse,
    feeMicroUsd: number,
    downstreamCostMicroUsd: number,
  ): Promise<void> {
    const row = this.requireStarted();
    const state = result.success ? "SETTLED" : "FAILED";
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE payment SET state=?, result_json=?, updated_at=? WHERE singleton=1 AND state='OUTBOUND_STARTED'",
      state,
      JSON.stringify(result),
      now,
    );
    this.enqueue({
      eventId: sha256Hex({ key: row.logical_key, projection: state }),
      logicalPaymentKey: row.logical_key,
      requestFingerprint: row.request_fingerprint,
      paymentIdentifier: row.payment_identifier,
      network: row.network,
      facilitatorId: row.facilitator_id ?? "unknown",
      state,
      transactionHash: result.transaction || null,
      testnet: row.testnet === 1,
      feeMicroUsd: result.success && row.testnet === 0 ? feeMicroUsd : 0,
      downstreamCostMicroUsd:
        result.success && row.testnet === 0 ? downstreamCostMicroUsd : 0,
      recordedAt: now,
      reasonCode: result.success
        ? null
        : (result.errorReason ?? "downstream_rejected"),
    });
    await this.ensureRecoveryAlarmSafely("finalize");
  }

  public async markAmbiguous(reasonCode: string): Promise<void> {
    this.markAmbiguousInternal(reasonCode);
    await this.ensureRecoveryAlarmSafely("mark_ambiguous");
  }

  public async flushOutbox(): Promise<number> {
    const rows = [
      ...this.sql.exec<OutboxRow>(
        "SELECT event_id,payload_json FROM outbox WHERE dispatched_at IS NULL ORDER BY rowid LIMIT 25",
      ),
    ];
    let flushed = 0;
    for (const row of rows) {
      const event = JSON.parse(row.payload_json) as SettlementProjectionEvent;
      try {
        const statements = [
          this.env.DB.prepare(
            `INSERT OR IGNORE INTO settlement_projection(
            logical_payment_key,request_fingerprint,payment_identifier,network,facilitator_id,state,transaction_hash,testnet,fee_micro_usd,downstream_cost_micro_usd,recorded_at
          ) VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
          ).bind(
            event.logicalPaymentKey,
            event.requestFingerprint,
            event.paymentIdentifier,
            event.network,
            event.facilitatorId,
            event.state,
            event.transactionHash,
            event.testnet ? 1 : 0,
            event.feeMicroUsd,
            event.downstreamCostMicroUsd,
            event.recordedAt,
          ),
        ];
        if (event.state === "SETTLED" && event.feeMicroUsd > 0) {
          statements.push(
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO usage_events(event_id,logical_payment_key,kind,fee_micro_usd,created_at) VALUES(?,?,'SUCCESSFUL_BILLABLE_SETTLEMENT',?,?)",
            ).bind(
              event.eventId,
              event.logicalPaymentKey,
              event.feeMicroUsd,
              event.recordedAt,
            ),
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) VALUES(?,?, 'UNEARNED_LIABILITY','DEBIT',?,?)",
            ).bind(
              `${event.eventId}:debit`,
              event.eventId,
              event.feeMicroUsd,
              event.recordedAt,
            ),
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) VALUES(?,?, 'EARNED_REVENUE','CREDIT',?,?)",
            ).bind(
              `${event.eventId}:credit`,
              event.eventId,
              event.feeMicroUsd,
              event.recordedAt,
            ),
          );
        }
        if (event.state === "AMBIGUOUS") {
          statements.push(
            this.env.DB.prepare(
              "INSERT OR IGNORE INTO reconciliation_cases(case_id,logical_payment_key,reason_code,details_json,created_at) VALUES(?,?,?,?,?)",
            ).bind(
              event.eventId,
              event.logicalPaymentKey,
              event.reasonCode ?? "unknown",
              JSON.stringify({ facilitatorId: event.facilitatorId }),
              event.recordedAt,
            ),
          );
        }
        await this.env.DB.batch(statements);
        this.sql.exec(
          "UPDATE outbox SET dispatched_at=?, attempts=attempts+1, last_error_code=NULL WHERE event_id=?",
          new Date().toISOString(),
          row.event_id,
        );
        flushed += 1;
      } catch (error) {
        this.sql.exec(
          "UPDATE outbox SET attempts=attempts+1,last_error_code=? WHERE event_id=?",
          errorCode(error),
          row.event_id,
        );
      }
    }
    await this.ensureRecoveryAlarm();
    return flushed;
  }

  public override async alarm(): Promise<void> {
    try {
      this.recoverStalePrepared(Date.now());
      this.recoverStaleStarted(Date.now());
      await this.flushOutbox();
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "payment_coordinator_alarm_failed",
          code: errorCode(error),
        }),
      );
      await this.scheduleNoLaterThan(Date.now() + OUTBOX_RETRY_DELAY_MS).catch(
        (scheduleError: unknown) => {
          console.error(
            JSON.stringify({
              timestamp: new Date().toISOString(),
              event: "payment_coordinator_alarm_reschedule_failed",
              code: errorCode(scheduleError),
            }),
          );
        },
      );
    }
  }

  private payment(): PaymentRow | null {
    return (
      [
        ...this.sql.exec<PaymentRow>("SELECT * FROM payment WHERE singleton=1"),
      ][0] ?? null
    );
  }

  private requireStarted(): PaymentRow {
    const row = this.payment();
    if (row === null || row.state !== "OUTBOUND_STARTED")
      throw new Error("Settlement is not in OUTBOUND_STARTED state");
    return row;
  }

  private markAmbiguousInternal(reasonCode: string): void {
    const row = this.requireStarted();
    const now = new Date().toISOString();
    const result: SettleResponse = {
      success: false,
      transaction: "",
      network: row.network as `${string}:${string}`,
      errorReason: "xguard_ambiguous",
      errorMessage:
        "Settlement outcome is uncertain; XGuard stopped automatic retry and opened reconciliation",
    };
    this.sql.exec(
      "UPDATE payment SET state='AMBIGUOUS', result_json=?, updated_at=? WHERE singleton=1 AND state='OUTBOUND_STARTED'",
      JSON.stringify(result),
      now,
    );
    this.enqueue({
      eventId: sha256Hex({ key: row.logical_key, projection: "AMBIGUOUS" }),
      logicalPaymentKey: row.logical_key,
      requestFingerprint: row.request_fingerprint,
      paymentIdentifier: row.payment_identifier,
      network: row.network,
      facilitatorId: row.facilitator_id ?? "unknown",
      state: "AMBIGUOUS",
      transactionHash: null,
      testnet: row.testnet === 1,
      feeMicroUsd: 0,
      downstreamCostMicroUsd: 0,
      recordedAt: now,
      reasonCode,
    });
  }

  private recoverStaleStarted(nowMs: number): boolean {
    const row = this.payment();
    if (row === null || row.state !== "OUTBOUND_STARTED") return false;
    const startedAt = Date.parse(String(row.updated_at));
    if (Number.isFinite(startedAt) && startedAt + SETTLEMENT_STALE_MS > nowMs)
      return false;
    this.markAmbiguousInternal("stale_outbound_started_recovery");
    return true;
  }

  private recoverStalePrepared(nowMs: number): boolean {
    const row = this.payment();
    if (row === null || row.state !== "OUTBOUND_PREPARED") return false;
    const preparedAt = Date.parse(String(row.updated_at));
    if (
      Number.isFinite(preparedAt) &&
      preparedAt + SETTLEMENT_PREPARED_STALE_MS > nowMs
    )
      return false;
    const now = new Date().toISOString();
    const result: SettleResponse = {
      success: false,
      transaction: "",
      network: row.network as `${string}:${string}`,
      errorReason: "xguard_prepared_expired",
      errorMessage:
        "Settlement ownership expired before outbound submission; a new authorization is required",
    };
    this.sql.exec(
      "UPDATE payment SET state='FAILED',result_json=?,updated_at=? WHERE singleton=1 AND state='OUTBOUND_PREPARED'",
      JSON.stringify(result),
      now,
    );
    this.enqueue({
      eventId: sha256Hex({ key: row.logical_key, projection: "FAILED" }),
      logicalPaymentKey: row.logical_key,
      requestFingerprint: row.request_fingerprint,
      paymentIdentifier: row.payment_identifier,
      network: row.network,
      facilitatorId: "not-submitted",
      state: "FAILED",
      transactionHash: null,
      testnet: row.testnet === 1,
      feeMicroUsd: 0,
      downstreamCostMicroUsd: 0,
      recordedAt: now,
      reasonCode: "prepared_expired_before_submission",
    });
    return true;
  }

  private async ensureRecoveryAlarmSafely(source: string): Promise<void> {
    try {
      await this.ensureRecoveryAlarm();
    } catch (error) {
      console.error(
        JSON.stringify({
          timestamp: new Date().toISOString(),
          event: "payment_coordinator_alarm_schedule_failed",
          source,
          code: errorCode(error),
        }),
      );
    }
  }

  private async ensureRecoveryAlarm(): Promise<void> {
    const now = Date.now();
    let dueAt: number | null = null;
    const payment = this.payment();
    if (payment?.state === "OUTBOUND_PREPARED") {
      const parsed = Date.parse(String(payment.updated_at));
      dueAt = Number.isFinite(parsed)
        ? Math.max(now + 1, parsed + SETTLEMENT_PREPARED_STALE_MS)
        : now + 1;
    } else if (payment?.state === "OUTBOUND_STARTED") {
      const parsed = Date.parse(String(payment.updated_at));
      dueAt = Number.isFinite(parsed)
        ? Math.max(now + 1, parsed + SETTLEMENT_STALE_MS)
        : now + 1;
    }
    const pending = [
      ...this.sql.exec<{ attempts: number }>(
        "SELECT attempts FROM outbox WHERE dispatched_at IS NULL ORDER BY attempts ASC LIMIT 1",
      ),
    ][0];
    if (pending !== undefined) {
      const outboxDue =
        now +
        (pending.attempts === 0
          ? OUTBOX_INITIAL_DELAY_MS
          : OUTBOX_RETRY_DELAY_MS);
      dueAt = dueAt === null ? outboxDue : Math.min(dueAt, outboxDue);
    }
    const current = await this.ctx.storage.getAlarm();
    if (dueAt === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current === null || current > dueAt)
      await this.ctx.storage.setAlarm(dueAt);
  }

  private async scheduleNoLaterThan(dueAt: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > dueAt)
      await this.ctx.storage.setAlarm(dueAt);
  }

  private enqueue(event: SettlementProjectionEvent): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO outbox(event_id,payload_json) VALUES(?,?)",
      event.eventId,
      JSON.stringify(event),
    );
  }
}

interface LeaseRow extends Record<string, SqlStorageValue> {
  expires_at_ms: number;
}

/** Per-client concurrency leases; one object is addressed per anonymous/API client. */
export class RequestGate extends DurableObject<Env> {
  private readonly sql: SqlStorage;

  public constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS leases (
        lease_id TEXT PRIMARY KEY,
        expires_at_ms INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS leases_expiry_idx ON leases(expires_at_ms);`);
    });
  }

  public async acquire(
    leaseId: string,
    nowMs: number,
    leaseMs: number,
    maximumConcurrent: number,
  ): Promise<boolean> {
    if (
      leaseId.length < 1 ||
      leaseId.length > 128 ||
      !Number.isSafeInteger(nowMs) ||
      !Number.isSafeInteger(leaseMs) ||
      leaseMs < 1 ||
      !Number.isSafeInteger(maximumConcurrent) ||
      maximumConcurrent < 1 ||
      maximumConcurrent > 64
    )
      throw new Error("Invalid concurrency lease request");
    this.prune(nowMs);
    if (
      [
        ...this.sql.exec(
          "SELECT 1 FROM leases WHERE lease_id=? LIMIT 1",
          leaseId,
        ),
      ].length > 0
    )
      return true;
    const count = [
      ...this.sql.exec<{ count: number }>(
        "SELECT COUNT(*) AS count FROM leases",
      ),
    ][0]?.count;
    if (count === undefined || count >= maximumConcurrent) return false;
    const expiresAt = nowMs + leaseMs;
    this.sql.exec(
      "INSERT INTO leases(lease_id,expires_at_ms) VALUES(?,?)",
      leaseId,
      expiresAt,
    );
    try {
      await this.scheduleNextAlarm();
    } catch (error) {
      this.sql.exec("DELETE FROM leases WHERE lease_id=?", leaseId);
      throw error;
    }
    return true;
  }

  public async release(leaseId: string): Promise<void> {
    this.sql.exec("DELETE FROM leases WHERE lease_id=?", leaseId);
    await this.scheduleNextAlarm();
  }

  public override async alarm(): Promise<void> {
    this.prune(Date.now());
    await this.scheduleNextAlarm();
  }

  private prune(nowMs: number): void {
    this.sql.exec("DELETE FROM leases WHERE expires_at_ms<=?", nowMs);
  }

  private async scheduleNextAlarm(): Promise<void> {
    const next = [
      ...this.sql.exec<LeaseRow>(
        "SELECT expires_at_ms FROM leases ORDER BY expires_at_ms LIMIT 1",
      ),
    ][0];
    const current = await this.ctx.storage.getAlarm();
    if (next === undefined) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current === null || current > next.expires_at_ms)
      await this.ctx.storage.setAlarm(next.expires_at_ms);
  }
}

const app = new Hono<{ Bindings: Env; Variables: Variables }>();

app.use("*", async (context, next) => {
  const requestId = crypto.randomUUID();
  context.set("requestId", requestId);
  const started = performance.now();
  await next();
  context.header("X-Request-ID", requestId);
  context.header("X-Content-Type-Options", "nosniff");
  context.header("X-Frame-Options", "DENY");
  context.header("Referrer-Policy", "no-referrer");
  context.header(
    "Cache-Control",
    context.req.method === "GET" ? "public, max-age=30" : "no-store",
  );
  log("request_complete", requestId, {
    path: context.req.path,
    method: context.req.method,
    status: context.res.status,
    latencyMs: Math.round(performance.now() - started),
  });
});
app.use("/verify", testnetAbuseProtection);
app.use("/settle", testnetAbuseProtection);

async function testnetAbuseProtection(
  context: Context<{ Bindings: Env; Variables: Variables }>,
  next: Next,
): Promise<Response | void> {
  const path = context.req.path;
  const requestId = context.get("requestId");
  const clientKey = abuseClientKey(context.req.raw);
  try {
    const [clientRate, globalRate] = await Promise.all([
      context.env.REQUEST_RATE_LIMITER.limit({ key: `${path}:${clientKey}` }),
      context.env.GLOBAL_RATE_LIMITER.limit({ key: path }),
    ]);
    if (!clientRate.success || !globalRate.success)
      return context.json({ error: "rate_limit_exceeded" }, 429, {
        "Retry-After": "60",
      });
  } catch (error) {
    log("request_rate_limiter_failed", requestId, { code: errorCode(error) });
    return context.json({ error: "protection_unavailable" }, 503);
  }

  const gate = context.env.REQUEST_GATE.getByName(clientKey);
  let acquired = false;
  try {
    acquired = await gate.acquire(
      requestId,
      Date.now(),
      CLIENT_LEASE_MS,
      CLIENT_CONCURRENCY_LIMIT,
    );
    if (!acquired)
      return context.json({ error: "concurrency_limit_exceeded" }, 429, {
        "Retry-After": "1",
      });
    await next();
  } catch (error) {
    log("request_concurrency_gate_failed", requestId, {
      code: errorCode(error),
    });
    return context.json({ error: "protection_unavailable" }, 503);
  } finally {
    if (acquired)
      await gate.release(requestId).catch((error: unknown) => {
        log("request_concurrency_release_failed", requestId, {
          code: errorCode(error),
        });
      });
  }
}

function abuseClientKey(request: Request): string {
  const authorization = request.headers.get("authorization");
  if (authorization !== null)
    return `authorization:${sha256Hex(authorization)}`;
  const connectingIp = request.headers.get("cf-connecting-ip") ?? "anonymous";
  return `anonymous:${sha256Hex(connectingIp)}`;
}

app.get("/", (context) =>
  context.json({
    name: "XGuard",
    description: "Health-aware safety and routing layer for x402 facilitators",
    version: "0.1.0-alpha.0",
    protocol: "x402-v2",
    mode: "testnet-only",
    price: {
      amount: "0.002",
      currency: "USD",
      event: "successful_billable_settlement",
      testnetCharged: false,
    },
    endpoints: {
      supported: "/supported",
      verify: "/verify",
      settle: "/settle",
      status: "/status",
    },
  }),
);

app.get("/healthz", (context) =>
  context.json({
    status: "ok",
    mode: "testnet-only",
    version: "0.1.0-alpha.0",
  }),
);
app.get("/readyz", async (context) => {
  try {
    await context.env.DB.prepare("SELECT 1 AS ready").first();
    const ready = await context.env.DB.prepare(
      "SELECT COUNT(*) AS count FROM facilitator_health WHERE state IN ('HEALTHY','DEGRADED') AND capabilities_json IS NOT NULL AND checked_at>=?",
    )
      .bind(healthFreshnessCutoff(context.env))
      .first<{ count: number }>();
    const routeCount = ready?.count ?? 0;
    return context.json(
      {
        status: routeCount > 0 ? "ready" : "not_ready",
        mainnet: false,
        measuredRoutes: routeCount,
      },
      routeCount > 0 ? 200 : 503,
    );
  } catch {
    return context.json({ status: "not_ready", mainnet: false }, 503);
  }
});

app.get("/supported", async (context) => {
  const rows = await context.env.DB.prepare(
    "SELECT capabilities_json FROM facilitator_health WHERE state IN ('HEALTHY','DEGRADED') AND capabilities_json IS NOT NULL AND checked_at>=?",
  )
    .bind(healthFreshnessCutoff(context.env))
    .all<{ capabilities_json: string }>();
  return context.json(
    combineCapabilities(
      rows.results.map(
        (row) => JSON.parse(row.capabilities_json) as SupportedResponse,
      ),
    ),
  );
});

app.get("/status", async (context) => {
  const rows = await context.env.DB.prepare(
    "SELECT facilitator_id,state,latency_ms,checked_at FROM facilitator_health ORDER BY facilitator_id",
  ).all();
  const ambiguous = await context.env.DB.prepare(
    "SELECT COUNT(*) AS count FROM reconciliation_cases WHERE state='OPEN'",
  ).first<{ count: number }>();
  const available = rows.results.some((row) => {
    const state = (row as { state?: unknown }).state;
    const latency = (row as { latency_ms?: unknown }).latency_ms;
    const checkedAt = (row as { checked_at?: unknown }).checked_at;
    return (
      (state === "HEALTHY" || state === "DEGRADED") &&
      latency !== null &&
      typeof checkedAt === "string" &&
      checkedAt >= healthFreshnessCutoff(context.env)
    );
  });
  return context.json({
    gateway: "operational",
    verification: available ? "operational" : "degraded",
    settlement: available ? "operational" : "degraded",
    mode: "testnet-only",
    facilitators: rows.results,
    openReconciliationCases: ambiguous?.count ?? 0,
    measuredAt: new Date().toISOString(),
  });
});

app.post("/verify", async (context) => {
  try {
    const body = await facilitatorRequest(context.req.raw);
    enforceTestnet(context.env, body.paymentRequirements.network);
    const identities = derivePaymentIdentities(
      body.paymentPayload,
      body.paymentRequirements,
    );
    const candidates = await route(
      context.env,
      body.paymentPayload,
      body.paymentRequirements,
    );
    let last: VerifyResponse | null = null;
    for (const facilitator of candidates) {
      try {
        const response = await downstreamJson(
          context.env,
          facilitator,
          "verify",
          body.raw,
        );
        const verified = asVerifyResponse(response, identities.payer);
        if (verified.isValid) return context.json(verified);
        last = verified;
      } catch (error) {
        log("verify_route_failed", context.get("requestId"), {
          facilitatorId: facilitator.id,
          code: errorCode(error),
        });
      }
    }
    return context.json(
      last ?? {
        isValid: false,
        invalidReason: "xguard_no_healthy_route",
        invalidMessage: "No compatible facilitator completed verification",
      },
    );
  } catch (error) {
    const normalized = normalize(error);
    return context.json(
      {
        isValid: false,
        invalidReason: normalized.code.toLowerCase(),
        invalidMessage: normalized.message,
      },
      httpStatus(normalized.status),
    );
  }
});

app.post("/settle", async (context) => {
  let network = "eip155:84532";
  try {
    const body = await facilitatorRequest(context.req.raw);
    network = body.paymentRequirements.network;
    enforceTestnet(context.env, network);
    const identities = derivePaymentIdentities(
      body.paymentPayload,
      body.paymentRequirements,
    );
    const [selected] = await route(
      context.env,
      body.paymentPayload,
      body.paymentRequirements,
    );
    if (selected === undefined)
      return context.json(
        failure(
          network,
          "xguard_no_healthy_route",
          "No compatible economically valid facilitator route exists",
        ),
        503,
      );
    await claimPaymentIdentifier(
      context.env,
      identities.paymentIdentifier,
      identities.logicalPaymentKey,
      identities.expiresAtSeconds,
    );
    const stub = context.env.PAYMENT_COORDINATOR.getByName(
      identities.logicalPaymentKey,
    );
    const prepared = await stub.prepare({
      logicalPaymentKey: identities.logicalPaymentKey,
      requestFingerprint: identities.requestFingerprint,
      paymentIdentifier: identities.paymentIdentifier,
      network,
      testnet: true,
    });
    if (prepared.kind === "CACHED" || prepared.kind === "FAILED")
      return context.json(prepared.result, 200, {
        "X-XGuard-Replayed": "true",
        "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      });
    if (prepared.kind === "CONFLICT")
      return context.json(
        failure(
          network,
          "xguard_payment_conflict",
          "The authorization was already bound to different request terms",
        ),
        409,
      );
    if (prepared.kind === "AMBIGUOUS")
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Settlement outcome is uncertain; automatic retry is disabled",
        ),
        503,
      );
    if (prepared.kind === "IN_PROGRESS")
      return context.json(
        failure(
          network,
          "xguard_in_progress",
          "Settlement is already in progress; retry later for its cached result",
        ),
        409,
      );

    if (!(await stub.start(selected.id)))
      return context.json(
        failure(
          network,
          "xguard_state_conflict",
          "Settlement ownership changed before submission",
        ),
        409,
      );

    try {
      const rawResult = await downstreamJson(
        context.env,
        selected,
        "settle",
        body.raw,
      );
      const result = asSettleResponse(
        rawResult,
        body.paymentRequirements,
        identities.payer,
      );
      if (!result.success && result.transaction !== "") {
        await stub.markAmbiguous(
          "downstream_failure_with_transaction_reference",
        );
        return context.json(
          failure(
            network,
            "xguard_ambiguous",
            "Downstream returned conflicting settlement evidence",
          ),
          503,
        );
      }
      const serializableResult = JSON.parse(
        JSON.stringify(result),
      ) as SettleResponse;
      await stub.finalize(
        serializableResult,
        feeMicroUsd(context.env),
        selected.costMicroUsd,
      );
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(result, 200, {
        "X-XGuard-Replayed": "false",
        "X-XGuard-Payment-Key": identities.logicalPaymentKey,
      });
    } catch (error) {
      await stub.markAmbiguous(errorCode(error));
      context.executionCtx.waitUntil(stub.flushOutbox());
      return context.json(
        failure(
          network,
          "xguard_ambiguous",
          "Submission started but final outcome was not trustworthy; reconciliation is required",
        ),
        503,
      );
    }
  } catch (error) {
    const normalized = normalize(error);
    return context.json(
      failure(network, normalized.code.toLowerCase(), normalized.message),
      httpStatus(normalized.status),
    );
  }
});

app.notFound((context) => context.json({ error: "not_found" }, 404));
app.onError((error, context) => {
  log("unhandled_error", context.get("requestId"), { code: errorCode(error) });
  return context.json({ error: "internal_error" }, 500);
});

export default {
  fetch: app.fetch,
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    ctx: ExecutionContext,
  ): Promise<void> {
    ctx.waitUntil(runMaintenance(env));
  },
} satisfies ExportedHandler<Env>;

interface ParsedRequest {
  raw: Record<string, unknown>;
  paymentPayload: PaymentPayload;
  paymentRequirements: PaymentRequirements;
}

async function facilitatorRequest(request: Request): Promise<ParsedRequest> {
  if (
    request.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() !==
    "application/json"
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Content-Type must be application/json",
      415,
    );
  const raw = asRecord(
    parseJsonStrict(
      await readHttpBodyTextCapped(
        request,
        MAX_HTTP_BODY_BYTES,
        "Facilitator request body",
      ),
    ),
  );
  const allowed = new Set([
    "x402Version",
    "paymentPayload",
    "paymentRequirements",
  ]);
  const unknown = Object.keys(raw).filter((key) => !allowed.has(key));
  if (
    unknown.length > 0 ||
    raw.x402Version !== 2 ||
    !("paymentPayload" in raw) ||
    !("paymentRequirements" in raw)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "Request must use the exact x402 v2 facilitator envelope",
      400,
    );
  const payload = parsePaymentPayload(raw.paymentPayload);
  const requirements = parsePaymentRequirements(raw.paymentRequirements);
  if (
    !payload.success ||
    payload.data.x402Version !== 2 ||
    !("accepted" in payload.data)
  )
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentPayload does not match the official x402 v2 schema",
      400,
    );
  if (!requirements.success || !("amount" in requirements.data))
    throw new XGuardError(
      "BAD_REQUEST",
      "paymentRequirements does not match the official x402 v2 schema",
      400,
    );
  return {
    raw,
    paymentPayload: payload.data as PaymentPayload,
    paymentRequirements: requirements.data as PaymentRequirements,
  };
}

async function claimPaymentIdentifier(
  env: Env,
  identifier: string | null,
  logicalKey: string,
  authorizationExpiry: bigint,
): Promise<void> {
  if (identifier === null) return;
  const now = Math.floor(Date.now() / 1_000);
  const ttl = boundedInteger(
    env.PAYMENT_IDENTIFIER_TTL_SECONDS,
    1,
    86_400,
    "PAYMENT_IDENTIFIER_TTL_SECONDS",
  );
  const expires = Number(
    authorizationExpiry < BigInt(now + ttl)
      ? authorizationExpiry
      : BigInt(now + ttl),
  );
  const [, selected] = await env.DB.batch([
    env.DB.prepare(
      `INSERT INTO payment_identifiers(identifier,logical_payment_key,expires_at_epoch,created_at) VALUES(?,?,?,?)
      ON CONFLICT(identifier) DO UPDATE SET logical_payment_key=excluded.logical_payment_key,expires_at_epoch=excluded.expires_at_epoch,created_at=excluded.created_at
      WHERE payment_identifiers.expires_at_epoch < ?`,
    ).bind(identifier, logicalKey, expires, new Date().toISOString(), now),
    env.DB.prepare(
      "SELECT logical_payment_key FROM payment_identifiers WHERE identifier=?",
    ).bind(identifier),
  ]);
  const owner =
    selected === undefined
      ? undefined
      : (selected.results[0] as { logical_payment_key?: string } | undefined)
          ?.logical_payment_key;
  if (owner !== logicalKey)
    throw new XGuardError(
      "PAYMENT_CONFLICT",
      "Payment identifier is already bound to a different active authorization",
      409,
    );
}

async function route(
  env: Env,
  payload: PaymentPayload,
  requirements: PaymentRequirements,
): Promise<FacilitatorConfig[]> {
  const configs = parseFacilitators(env).filter(
    (item) =>
      item.networks.includes(requirements.network) &&
      item.schemes.includes(requirements.scheme),
  );
  const health = await env.DB.prepare(
    "SELECT facilitator_id,state,latency_ms,capabilities_json,checked_at FROM facilitator_health",
  ).all<{
    facilitator_id: string;
    state: string;
    latency_ms: number | null;
    capabilities_json: string | null;
    checked_at: string;
  }>();
  const byId = new Map(health.results.map((row) => [row.facilitator_id, row]));
  const fee = feeMicroUsd(env);
  const requiredExtensions = facilitatorExtensionKeys(payload);
  return configs
    .filter((item) => env.MODE === "testnet" || item.costMicroUsd < fee)
    .filter(
      (item) =>
        (byId.get(item.id)?.checked_at ?? "") >= healthFreshnessCutoff(env) &&
        !["OPEN", "QUARANTINED", "DISABLED"].includes(
          byId.get(item.id)?.state ?? "HEALTHY",
        ),
    )
    .filter((item) => {
      const json = byId.get(item.id)?.capabilities_json;
      if (json === null || json === undefined) return false;
      const capabilities = JSON.parse(json) as SupportedResponse;
      return (
        requiredExtensions.every((extension) =>
          capabilities.extensions.includes(extension),
        ) &&
        capabilities.kinds.some(
          (kind) =>
            kind.x402Version === 2 &&
            kind.network === requirements.network &&
            kind.scheme === requirements.scheme &&
            mechanismMatches(kind.extra, requirements.extra),
        )
      );
    })
    .sort((left, right) => {
      const statePenalty = (id: string): number =>
        byId.get(id)?.state === "DEGRADED" ? 1_000_000 : 0;
      const leftScore =
        statePenalty(left.id) +
        (byId.get(left.id)?.latency_ms ?? 500) +
        left.costMicroUsd -
        left.priority;
      const rightScore =
        statePenalty(right.id) +
        (byId.get(right.id)?.latency_ms ?? 500) +
        right.costMicroUsd -
        right.priority;
      return leftScore - rightScore || left.id.localeCompare(right.id);
    });
}

function facilitatorExtensionKeys(payload: PaymentPayload): string[] {
  return Object.keys(payload.extensions ?? {}).filter(
    (key) =>
      key !== "payment-identifier" &&
      key !== "offer-receipt" &&
      key !== "sign-in-with-x",
  );
}

function mechanismMatches(
  capability: Record<string, unknown> | undefined,
  required: Record<string, unknown> | null | undefined,
): boolean {
  const requiredTransferMethod =
    required?.assetTransferMethod === undefined
      ? "eip3009"
      : required.assetTransferMethod;
  const requiredFlow =
    required?.paymentFlow === undefined
      ? "authorization"
      : required.paymentFlow;
  return (
    (requiredTransferMethod === "eip3009" ||
      requiredTransferMethod === "permit2") &&
    capability?.assetTransferMethod === requiredTransferMethod &&
    requiredFlow === "authorization" &&
    capability?.paymentFlow === requiredFlow
  );
}

async function downstreamJson(
  env: Env,
  facilitator: FacilitatorConfig,
  operation: "verify" | "settle",
  body: Record<string, unknown>,
): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    operation === "settle" ? 20_000 : 8_000,
  );
  try {
    const response = await fetch(`${facilitator.baseUrl}/${operation}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "XGuard/0.1.0-alpha.0",
        "X-XGuard-Mode": env.MODE,
      },
      body: JSON.stringify(body),
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`downstream_http_${response.status}`);
    const text = await readHttpBodyTextCapped(
      response,
      MAX_HTTP_BODY_BYTES,
      "Downstream facilitator response",
    );
    return parseJsonStrict(text);
  } finally {
    clearTimeout(timer);
  }
}

function asVerifyResponse(
  value: unknown,
  expectedPayer: string,
): VerifyResponse {
  const record = asRecord(value);
  if (typeof record.isValid !== "boolean")
    throw new Error("malformed_verify_response");
  if (
    record.payer !== undefined &&
    (typeof record.payer !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(record.payer) ||
      record.payer.toLowerCase() !== expectedPayer.toLowerCase())
  )
    throw new Error("malformed_verify_response");
  return record as VerifyResponse;
}

function asSettleResponse(
  value: unknown,
  requirements: PaymentRequirements,
  expectedPayer: string,
): SettleResponse {
  const record = asRecord(value);
  if (
    typeof record.success !== "boolean" ||
    typeof record.transaction !== "string" ||
    record.network !== requirements.network
  )
    throw new Error("malformed_settle_response");
  if (record.success && record.transaction.length === 0)
    throw new Error("settle_success_without_transaction");
  if (
    record.success &&
    requirements.network.startsWith("eip155:") &&
    !/^0x[0-9a-fA-F]{64}$/.test(record.transaction)
  )
    throw new Error("malformed_evm_transaction_reference");
  if (!record.success && record.transaction.length > 0)
    throw new Error("failed_settlement_with_transaction_reference");
  if (
    record.amount !== undefined &&
    (typeof record.amount !== "string" ||
      parseUnsignedInteger(record.amount, "settlement.amount") !==
        parseUnsignedInteger(requirements.amount, "paymentRequirements.amount"))
  )
    throw new Error("settlement_amount_conflict");
  if (
    record.payer !== undefined &&
    (typeof record.payer !== "string" ||
      !/^0x[0-9a-fA-F]{40}$/.test(record.payer) ||
      record.payer.toLowerCase() !== expectedPayer.toLowerCase())
  )
    throw new Error("malformed_settlement_payer");
  return record as SettleResponse;
}

function parseFacilitators(env: Env): FacilitatorConfig[] {
  const parsed: unknown = JSON.parse(env.FACILITATORS_JSON);
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 16)
    throw new Error("Invalid FACILITATORS_JSON");
  const seen = new Set<string>();
  return parsed.map((value) => {
    const item = asRecord(value);
    if (
      typeof item.id !== "string" ||
      !/^[a-z0-9][a-z0-9-]{1,62}$/.test(item.id) ||
      seen.has(item.id)
    )
      throw new Error("Invalid or duplicate facilitator id");
    seen.add(item.id);
    if (typeof item.baseUrl !== "string")
      throw new Error("Invalid facilitator baseUrl");
    const url = new URL(item.baseUrl);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        "Facilitator baseUrl must be a credential-free HTTPS URL",
      );
    if (
      !Array.isArray(item.networks) ||
      !item.networks.every((network) => typeof network === "string")
    )
      throw new Error("Invalid facilitator networks");
    if (
      !Array.isArray(item.schemes) ||
      !item.schemes.every((scheme) => typeof scheme === "string")
    )
      throw new Error("Invalid facilitator schemes");
    const cost = boundedInteger(
      String(item.costMicroUsd),
      0,
      1_000_000_000,
      "facilitator costMicroUsd",
    );
    const priority = boundedInteger(
      String(item.priority),
      0,
      1_000_000,
      "facilitator priority",
    );
    const transferMethods = item.exactEvmTransferMethods;
    if (
      !Array.isArray(transferMethods) ||
      transferMethods.length < 1 ||
      !transferMethods.every(
        (method) => method === "eip3009" || method === "permit2",
      )
    )
      throw new Error(
        "Facilitator exactEvmTransferMethods must explicitly list eip3009 and/or permit2",
      );
    return {
      id: item.id,
      baseUrl: url.toString().replace(/\/$/, ""),
      networks: [...item.networks] as string[],
      schemes: [...item.schemes] as string[],
      costMicroUsd: cost,
      priority,
      exactEvmTransferMethods: [
        ...new Set(transferMethods as ("eip3009" | "permit2")[]),
      ],
    };
  });
}

async function runMaintenance(env: Env): Promise<void> {
  const now = new Date().toISOString();
  for (const facilitator of parseFacilitators(env)) {
    const started = performance.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      let response: Response;
      try {
        response = await fetch(`${facilitator.baseUrl}/supported`, {
          redirect: "manual",
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!response.ok) throw new Error(`health_http_${response.status}`);
      let text: string;
      try {
        text = await readHttpBodyTextCapped(
          response,
          MAX_HTTP_BODY_BYTES,
          "Facilitator capability response",
        );
      } catch {
        throw new FacilitatorCapabilityError("health_supported_oversized");
      }
      let parsedCapabilities: unknown;
      try {
        parsedCapabilities = parseJsonStrict(text);
      } catch {
        throw new FacilitatorCapabilityError("health_malformed_supported_json");
      }
      const compatible = validateSupportedCapabilities(
        parsedCapabilities,
        facilitator,
      );
      await env.DB.prepare(
        `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,latency_ms,last_error_code,capabilities_json,checked_at)
        VALUES(?,'HEALTHY',0,?,NULL,?,?) ON CONFLICT(facilitator_id) DO UPDATE SET state='HEALTHY',consecutive_failures=0,latency_ms=excluded.latency_ms,last_error_code=NULL,capabilities_json=excluded.capabilities_json,checked_at=excluded.checked_at`,
      )
        .bind(
          facilitator.id,
          Math.round(performance.now() - started),
          JSON.stringify(compatible),
          now,
        )
        .run();
    } catch (error) {
      if (error instanceof FacilitatorCapabilityError) {
        await env.DB.prepare(
          `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,last_error_code,checked_at)
          VALUES(?,'QUARANTINED',1,?,?) ON CONFLICT(facilitator_id) DO UPDATE SET state='QUARANTINED',consecutive_failures=facilitator_health.consecutive_failures+1,last_error_code=excluded.last_error_code,checked_at=excluded.checked_at`,
        )
          .bind(facilitator.id, errorCode(error), now)
          .run();
        continue;
      }
      await env.DB.prepare(
        `INSERT INTO facilitator_health(facilitator_id,state,consecutive_failures,last_error_code,checked_at)
        VALUES(?,'DEGRADED',1,?,?) ON CONFLICT(facilitator_id) DO UPDATE SET
        consecutive_failures=facilitator_health.consecutive_failures+1,
        state=CASE WHEN facilitator_health.consecutive_failures+1 >= 3 THEN 'OPEN' ELSE 'DEGRADED' END,
        last_error_code=excluded.last_error_code,checked_at=excluded.checked_at`,
      )
        .bind(facilitator.id, errorCode(error), now)
        .run();
    }
  }
  await env.DB.prepare(
    "DELETE FROM payment_identifiers WHERE expires_at_epoch < ?",
  )
    .bind(Math.floor(Date.now() / 1_000))
    .run();
  const imbalance = await env.DB.prepare(
    `SELECT event_id FROM ledger_entries GROUP BY event_id
    HAVING SUM(CASE WHEN side='DEBIT' THEN amount_micro_usd ELSE -amount_micro_usd END) != 0 LIMIT 1`,
  ).first<{ event_id: string }>();
  if (imbalance !== null) {
    await env.DB.prepare(
      "INSERT OR IGNORE INTO reconciliation_cases(case_id,reason_code,details_json,state,created_at) VALUES(?, 'ledger_imbalance', ?, 'QUARANTINED', ?)",
    )
      .bind(
        sha256Hex({ imbalance: imbalance.event_id }),
        JSON.stringify({ eventIdHash: sha256Hex(imbalance.event_id) }),
        now,
      )
      .run();
  }
}

class FacilitatorCapabilityError extends Error {}

function validateSupportedCapabilities(
  value: unknown,
  facilitator: FacilitatorConfig,
): SupportedResponse {
  const record = asCapabilityRecord(value);
  if (
    !Array.isArray(record.kinds) ||
    record.kinds.length > 256 ||
    !Array.isArray(record.extensions) ||
    record.extensions.length > 128 ||
    typeof record.signers !== "object" ||
    record.signers === null ||
    Array.isArray(record.signers)
  )
    throw new FacilitatorCapabilityError("health_malformed_supported");
  const kinds = record.kinds.map((value) => {
    const kind = asCapabilityRecord(value);
    if (
      !Number.isSafeInteger(kind.x402Version) ||
      (kind.x402Version as number) <= 0 ||
      typeof kind.scheme !== "string" ||
      kind.scheme.length > 64 ||
      typeof kind.network !== "string" ||
      kind.network.length > 128 ||
      (kind.extra !== undefined &&
        (typeof kind.extra !== "object" ||
          kind.extra === null ||
          Array.isArray(kind.extra)))
    )
      throw new FacilitatorCapabilityError("health_malformed_supported_kind");
    return {
      x402Version: kind.x402Version as number,
      scheme: kind.scheme,
      network: kind.network,
      extra: (kind.extra ?? {}) as Record<string, unknown>,
    };
  });
  const allowedKinds = kinds.flatMap((kind) => {
    if (
      kind.x402Version !== 2 ||
      !kind.network.includes(":") ||
      !facilitator.networks.includes(kind.network) ||
      !facilitator.schemes.includes(kind.scheme)
    )
      return [];
    const explicitTransferMethod = kind.extra.assetTransferMethod;
    const paymentFlow = kind.extra.paymentFlow ?? "authorization";
    if (
      (explicitTransferMethod !== undefined &&
        explicitTransferMethod !== "eip3009" &&
        explicitTransferMethod !== "permit2") ||
      paymentFlow !== "authorization"
    )
      return [];
    const transferMethods =
      explicitTransferMethod === undefined
        ? facilitator.exactEvmTransferMethods
        : facilitator.exactEvmTransferMethods.includes(explicitTransferMethod)
          ? [explicitTransferMethod]
          : [];
    return transferMethods.map((assetTransferMethod) => ({
      x402Version: 2,
      scheme: kind.scheme,
      network: kind.network as `${string}:${string}`,
      extra: {
        ...kind.extra,
        assetTransferMethod,
        paymentFlow,
      },
    }));
  });
  if (allowedKinds.length === 0)
    throw new FacilitatorCapabilityError("health_no_configured_capability");
  if (
    !record.extensions.every(
      (value) => typeof value === "string" && value.length <= 128,
    )
  )
    throw new FacilitatorCapabilityError("health_malformed_extensions");
  const signers: Record<string, string[]> = {};
  for (const [family, values] of Object.entries(record.signers)) {
    if (
      family.length > 64 ||
      !Array.isArray(values) ||
      values.length > 256 ||
      !values.every((value) => typeof value === "string" && value.length <= 256)
    )
      throw new FacilitatorCapabilityError("health_malformed_signers");
    signers[family] = values as string[];
  }
  return {
    kinds: allowedKinds,
    extensions: record.extensions as string[],
    signers,
  };
}

function asCapabilityRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new FacilitatorCapabilityError("health_malformed_supported_object");
  return value as Record<string, unknown>;
}

function combineCapabilities(values: SupportedResponse[]): SupportedResponse {
  const kinds = new Map<string, SupportedResponse["kinds"][number]>();
  let extensions: Set<string> | null = null;
  let signers: Map<string, Set<string>> | null = null;
  for (const value of values) {
    for (const kind of value.kinds)
      kinds.set(
        `${kind.x402Version}:${kind.scheme}:${kind.network}:${JSON.stringify(kind.extra ?? {})}`,
        kind,
      );
    const advertisedExtensions = new Set(value.extensions);
    if (extensions === null) extensions = advertisedExtensions;
    else {
      const previous: Set<string> = extensions;
      extensions = new Set<string>(
        [...previous].filter((extension) =>
          advertisedExtensions.has(extension),
        ),
      );
    }
    const advertisedSigners = new Map(
      Object.entries(value.signers).map(([family, addresses]) => [
        family,
        new Set(addresses),
      ]),
    );
    if (signers === null) signers = advertisedSigners;
    else {
      for (const [family, addresses] of signers) {
        const next = advertisedSigners.get(family);
        if (next === undefined) {
          signers.delete(family);
          continue;
        }
        for (const address of addresses)
          if (!next.has(address)) addresses.delete(address);
        if (addresses.size === 0) signers.delete(family);
      }
    }
  }
  return {
    kinds: [...kinds.values()],
    extensions: [...(extensions ?? [])].sort(),
    signers: Object.fromEntries(
      [...(signers ?? new Map<string, Set<string>>())].map(
        ([family, addresses]) => [family, [...addresses].sort()],
      ),
    ),
  };
}

function enforceTestnet(env: Env, network: string): void {
  if (env.MODE !== "testnet" || !isKnownTestnet(network))
    throw new XGuardError(
      "UNSUPPORTED",
      "Mainnet settlement is disabled until legal, security, reconciliation, and treasury gates are approved",
      503,
    );
}

function healthFreshnessCutoff(env: Env): string {
  const maximumAgeSeconds = boundedInteger(
    env.HEALTH_MAX_AGE_SECONDS,
    60,
    3_600,
    "HEALTH_MAX_AGE_SECONDS",
  );
  return new Date(Date.now() - maximumAgeSeconds * 1_000).toISOString();
}

function feeMicroUsd(env: Env): number {
  return boundedInteger(
    env.XGUARD_FEE_MICRO_USD,
    1,
    1_000_000_000,
    "XGUARD_FEE_MICRO_USD",
  );
}

function boundedInteger(
  value: string,
  minimum: number,
  maximum: number,
  name: string,
): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value))
    throw new Error(`${name} must be an unsigned integer`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${name} is outside its allowed range`);
  return parsed;
}

function failure(
  network: string,
  reason: string,
  message: string,
): SettleResponse {
  return {
    success: false,
    transaction: "",
    network: network as `${string}:${string}`,
    errorReason: reason,
    errorMessage: message,
  };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new XGuardError("BAD_REQUEST", "Expected a JSON object", 400);
  return value as Record<string, unknown>;
}

function normalize(error: unknown): XGuardError {
  return error instanceof XGuardError
    ? error
    : new XGuardError(
        "INTERNAL_ERROR",
        "XGuard failed closed while processing the request",
        500,
      );
}

function httpStatus(status: number): 400 | 409 | 413 | 415 | 500 | 503 {
  return status as 400 | 409 | 413 | 415 | 500 | 503;
}
function errorCode(error: unknown): string {
  return error instanceof Error ? error.name.slice(0, 64) : "unknown_error";
}
function log(
  event: string,
  requestId: string,
  fields: Record<string, string | number>,
): void {
  console.log(
    JSON.stringify({
      timestamp: new Date().toISOString(),
      event,
      requestId,
      ...fields,
    }),
  );
}
