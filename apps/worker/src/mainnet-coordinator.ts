import { DurableObject } from "cloudflare:workers";
import type { SettleResponse } from "@x402/core/types";
import {
  markSettlementFeeAmbiguous,
  releaseSettlementFee,
} from "./mainnet-billing.js";

const PREPARED_STALE_MS = 120_000;
const STARTED_STALE_MS = 120_000;
const OUTBOX_RETRY_MS = 60_000;

export interface MainnetCoordinatorEnv {
  DB: D1Database;
}

interface PaymentRow extends Record<string, SqlStorageValue> {
  logical_key: string;
  request_fingerprint: string;
  merchant_id: string;
  network: string;
  state: string;
  facilitator_id: string | null;
  result_json: string | null;
  created_at: string;
  updated_at: string;
}

interface OutboxRow extends Record<string, SqlStorageValue> {
  event_id: string;
  payload_json: string;
  attempts: number;
}

export interface MainnetPrepareInput {
  logicalPaymentKey: string;
  requestFingerprint: string;
  merchantId: string;
  network: string;
}

export type MainnetPrepareResult =
  | { kind: "OWNER" }
  | { kind: "CACHED"; result: SettleResponse }
  | { kind: "FAILED"; result: SettleResponse | null }
  | { kind: "IN_PROGRESS" }
  | { kind: "AMBIGUOUS" }
  | { kind: "CONFLICT" };

interface ProjectionEvent {
  eventId: string;
  logicalPaymentKey: string;
  requestFingerprint: string;
  merchantId: string;
  network: string;
  facilitatorId: string;
  state: "SETTLED" | "FAILED" | "AMBIGUOUS";
  transactionHash: string | null;
  recordedAt: string;
  reasonCode: string | null;
}

export class MainnetPaymentCoordinator extends DurableObject<MainnetCoordinatorEnv> {
  private readonly sql: SqlStorage;

  public constructor(ctx: DurableObjectState, env: MainnetCoordinatorEnv) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    ctx.blockConcurrencyWhile(async () => {
      this.sql.exec(`CREATE TABLE IF NOT EXISTS payment (
        singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
        logical_key TEXT NOT NULL UNIQUE,
        request_fingerprint TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        network TEXT NOT NULL,
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

  public async prepare(input: MainnetPrepareInput): Promise<MainnetPrepareResult> {
    await this.recoverStale();
    const existing = this.payment();
    if (existing === null) {
      const now = new Date().toISOString();
      this.sql.exec(
        "INSERT INTO payment(singleton,logical_key,request_fingerprint,merchant_id,network,state,created_at,updated_at) VALUES(1,?,?,?,?,'OUTBOUND_PREPARED',?,?)",
        input.logicalPaymentKey,
        input.requestFingerprint,
        input.merchantId,
        input.network,
        now,
        now,
      );
      await this.scheduleNoLaterThan(Date.now() + PREPARED_STALE_MS);
      return { kind: "OWNER" };
    }
    if (
      existing.logical_key !== input.logicalPaymentKey ||
      existing.request_fingerprint !== input.requestFingerprint ||
      existing.merchant_id !== input.merchantId ||
      existing.network !== input.network
    )
      return { kind: "CONFLICT" };
    if (existing.state === "SETTLED" && existing.result_json !== null)
      return {
        kind: "CACHED",
        result: JSON.parse(existing.result_json) as SettleResponse,
      };
    if (existing.state === "FAILED")
      return {
        kind: "FAILED",
        result:
          existing.result_json === null
            ? null
            : (JSON.parse(existing.result_json) as SettleResponse),
      };
    if (existing.state === "AMBIGUOUS") return { kind: "AMBIGUOUS" };
    return { kind: "IN_PROGRESS" };
  }

  public async abandonPrepared(): Promise<boolean> {
    const row = this.payment();
    if (row === null || row.state !== "OUTBOUND_PREPARED") return false;
    await releaseSettlementFee(this.env.DB, row.merchant_id, row.logical_key).catch(
      () => undefined,
    );
    this.sql.exec("DELETE FROM payment WHERE singleton=1 AND state='OUTBOUND_PREPARED'");
    await this.ensureAlarm();
    return true;
  }

  public async start(facilitatorId: string): Promise<boolean> {
    const now = Date.now();
    const cursor = this.sql.exec(
      "UPDATE payment SET state='OUTBOUND_STARTED',facilitator_id=?,updated_at=? WHERE singleton=1 AND state='OUTBOUND_PREPARED'",
      facilitatorId,
      new Date(now).toISOString(),
    );
    if (cursor.rowsWritten === 1)
      await this.scheduleNoLaterThan(now + STARTED_STALE_MS);
    else await this.ensureAlarm();
    return cursor.rowsWritten === 1;
  }

  public async finalize(
    result: SettleResponse,
    reasonCode: string | null = null,
  ): Promise<void> {
    const row = this.requireStarted();
    const state = result.success ? "SETTLED" : "FAILED";
    const now = new Date().toISOString();
    const cursor = this.sql.exec(
      "UPDATE payment SET state=?,result_json=?,updated_at=? WHERE singleton=1 AND state='OUTBOUND_STARTED'",
      state,
      JSON.stringify(result),
      now,
    );
    if (cursor.rowsWritten !== 1) throw new Error("coordinator_finalize_conflict");
    this.enqueue({
      eventId: `${row.logical_key}:${state}`,
      logicalPaymentKey: row.logical_key,
      requestFingerprint: row.request_fingerprint,
      merchantId: row.merchant_id,
      network: row.network,
      facilitatorId: row.facilitator_id ?? "payai-mainnet",
      state,
      transactionHash: result.transaction || null,
      recordedAt: now,
      reasonCode,
    });
    await this.ensureAlarm();
  }

  public async markAmbiguous(reasonCode: string): Promise<void> {
    const row = this.payment();
    if (row === null) throw new Error("coordinator_payment_missing");
    if (row.state === "AMBIGUOUS") return;
    if (row.state !== "OUTBOUND_STARTED")
      throw new Error("coordinator_not_started");
    const now = new Date().toISOString();
    this.sql.exec(
      "UPDATE payment SET state='AMBIGUOUS',updated_at=? WHERE singleton=1 AND state='OUTBOUND_STARTED'",
      now,
    );
    await markSettlementFeeAmbiguous(
      this.env.DB,
      row.merchant_id,
      row.logical_key,
    ).catch(() => undefined);
    this.enqueue({
      eventId: `${row.logical_key}:AMBIGUOUS`,
      logicalPaymentKey: row.logical_key,
      requestFingerprint: row.request_fingerprint,
      merchantId: row.merchant_id,
      network: row.network,
      facilitatorId: row.facilitator_id ?? "payai-mainnet",
      state: "AMBIGUOUS",
      transactionHash: null,
      recordedAt: now,
      reasonCode,
    });
    await this.ensureAlarm();
  }

  public async flushOutbox(): Promise<number> {
    let dispatched = 0;
    for (const row of [
      ...this.sql.exec<OutboxRow>(
        "SELECT event_id,payload_json,attempts FROM outbox WHERE dispatched_at IS NULL ORDER BY rowid LIMIT 20",
      ),
    ]) {
      const event = JSON.parse(row.payload_json) as ProjectionEvent;
      try {
        await projectSettlement(this.env.DB, event);
        this.sql.exec(
          "UPDATE outbox SET dispatched_at=?,attempts=attempts+1,last_error_code=NULL WHERE event_id=?",
          new Date().toISOString(),
          row.event_id,
        );
        dispatched += 1;
      } catch (error) {
        this.sql.exec(
          "UPDATE outbox SET attempts=attempts+1,last_error_code=? WHERE event_id=?",
          errorCode(error),
          row.event_id,
        );
        break;
      }
    }
    await this.ensureAlarm();
    return dispatched;
  }

  public override async alarm(): Promise<void> {
    await this.recoverStale();
    await this.flushOutbox();
    await this.ensureAlarm();
  }

  private payment(): PaymentRow | null {
    return [...this.sql.exec<PaymentRow>("SELECT * FROM payment WHERE singleton=1")][0] ?? null;
  }

  private requireStarted(): PaymentRow {
    const row = this.payment();
    if (row === null || row.state !== "OUTBOUND_STARTED")
      throw new Error("coordinator_not_started");
    return row;
  }

  private async recoverStale(): Promise<void> {
    const row = this.payment();
    if (row === null) return;
    const updated = Date.parse(row.updated_at);
    if (!Number.isFinite(updated)) return;
    const age = Date.now() - updated;
    if (row.state === "OUTBOUND_PREPARED" && age >= PREPARED_STALE_MS) {
      await releaseSettlementFee(
        this.env.DB,
        row.merchant_id,
        row.logical_key,
      ).catch(() => undefined);
      this.sql.exec("DELETE FROM payment WHERE singleton=1 AND state='OUTBOUND_PREPARED'");
      return;
    }
    if (row.state === "OUTBOUND_STARTED" && age >= STARTED_STALE_MS) {
      await this.markAmbiguous("outbound_started_stale");
    }
  }

  private enqueue(event: ProjectionEvent): void {
    this.sql.exec(
      "INSERT OR IGNORE INTO outbox(event_id,payload_json) VALUES(?,?)",
      event.eventId,
      JSON.stringify(event),
    );
  }

  private async ensureAlarm(): Promise<void> {
    const row = this.payment();
    let due: number | null = null;
    if (row !== null) {
      const updated = Date.parse(row.updated_at);
      if (Number.isFinite(updated)) {
        if (row.state === "OUTBOUND_PREPARED") due = updated + PREPARED_STALE_MS;
        if (row.state === "OUTBOUND_STARTED") due = updated + STARTED_STALE_MS;
      }
    }
    const pending = [
      ...this.sql.exec("SELECT 1 FROM outbox WHERE dispatched_at IS NULL LIMIT 1"),
    ].length > 0;
    if (pending) {
      const outboxDue = Date.now() + OUTBOX_RETRY_MS;
      due = due === null ? outboxDue : Math.min(due, outboxDue);
    }
    const current = await this.ctx.storage.getAlarm();
    if (due === null) {
      if (current !== null) await this.ctx.storage.deleteAlarm();
      return;
    }
    if (current === null || current > due) await this.ctx.storage.setAlarm(due);
  }

  private async scheduleNoLaterThan(dueAt: number): Promise<void> {
    const current = await this.ctx.storage.getAlarm();
    if (current === null || current > dueAt) await this.ctx.storage.setAlarm(dueAt);
  }
}

interface LeaseRow extends Record<string, SqlStorageValue> {
  expires_at_ms: number;
}

export class MainnetRequestGate extends DurableObject<MainnetCoordinatorEnv> {
  private readonly sql: SqlStorage;

  public constructor(ctx: DurableObjectState, env: MainnetCoordinatorEnv) {
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
    this.prune(nowMs);
    if (
      [...this.sql.exec("SELECT 1 FROM leases WHERE lease_id=? LIMIT 1", leaseId)]
        .length > 0
    )
      return true;
    const count = [
      ...this.sql.exec<{ count: number }>("SELECT COUNT(*) AS count FROM leases"),
    ][0]?.count;
    if (count === undefined || count >= maximumConcurrent) return false;
    this.sql.exec(
      "INSERT INTO leases(lease_id,expires_at_ms) VALUES(?,?)",
      leaseId,
      nowMs + leaseMs,
    );
    await this.scheduleNextAlarm();
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

async function projectSettlement(
  db: D1Database,
  event: ProjectionEvent,
): Promise<void> {
  const state = event.state === "SETTLED" ? "AMBIGUOUS" : event.state;
  await db
    .prepare(
      `INSERT INTO settlement_projection(logical_payment_key,request_fingerprint,payment_identifier,network,facilitator_id,state,transaction_hash,testnet,fee_micro_usd,downstream_cost_micro_usd,recorded_at,reason_code)
       VALUES(?,?,NULL,?,?,?,?,0,0,0,?,?)
       ON CONFLICT(logical_payment_key) DO UPDATE SET facilitator_id=excluded.facilitator_id,state=excluded.state,transaction_hash=excluded.transaction_hash,recorded_at=excluded.recorded_at,reason_code=excluded.reason_code`,
    )
    .bind(
      event.logicalPaymentKey,
      event.requestFingerprint,
      event.network,
      event.facilitatorId,
      state,
      event.transactionHash,
      event.recordedAt,
      event.reasonCode,
    )
    .run();
  if (event.state === "AMBIGUOUS") {
    await db
      .prepare(
        `INSERT INTO reconciliation_cases(case_id,logical_payment_key,state,reason,opened_at,updated_at)
         VALUES(?,?,'OPEN',?,?,?) ON CONFLICT(case_id) DO NOTHING`,
      )
      .bind(
        `mainnet:${event.logicalPaymentKey}`,
        event.logicalPaymentKey,
        event.reasonCode ?? "mainnet_settlement_ambiguous",
        event.recordedAt,
        event.recordedAt,
      )
      .run();
  }
}

function errorCode(error: unknown): string {
  if (error instanceof Error)
    return error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
  return "unknown_error";
}
