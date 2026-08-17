export type GatewayEventKind =
  "MODEL" | "TOOL" | "SOURCE" | "ANALYSIS" | "SECURITY";

interface GatewayReservationRow {
  event_key: string;
  merchant_id: string;
  request_id: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
  amount_micro_usd: number;
  state: "HELD" | "EARNED" | "RELEASED";
  operation_id: string | null;
}

export interface GatewayReservation {
  eventKey: string;
  merchantId: string;
  requestId: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
  amountMicroUsd: number;
  state: GatewayReservationRow["state"];
}

export interface GatewayFeeInput {
  merchantId: string;
  requestId: string;
  kind: GatewayEventKind;
  provider: string;
  operation: string;
  amountMicroUsd: number;
}

export interface GatewayEarnInput {
  merchantId: string;
  eventKey: string;
  upstreamStatus?: number;
  latencyMs: number;
  requestBytes?: number;
  responseBytes?: number;
}

const MAX_SAFE_MICRO_USD = Number.MAX_SAFE_INTEGER;

export function gatewayEventKey(merchantId: string, requestId: string): string {
  if (!/^[0-9a-f-]{36}$/i.test(merchantId))
    throw new Error("invalid_merchant_id");
  if (!/^[A-Za-z0-9._:-]{8,96}$/.test(requestId))
    throw new Error("invalid_gateway_request_id");
  return `gw:${merchantId}:${requestId}`;
}

export async function reserveGatewayFee(
  db: D1Database,
  input: GatewayFeeInput,
): Promise<GatewayReservation> {
  validateFeeInput(input);
  const eventKey = gatewayEventKey(input.merchantId, input.requestId);
  const existing = await reservation(db, eventKey);
  if (existing !== null) {
    assertReservationMatches(existing, input);
    if (existing.state === "EARNED")
      throw new Error("gateway_event_already_earned");
    if (existing.state === "HELD") throw new Error("gateway_event_in_progress");
    return reholdGatewayFee(db, existing);
  }

  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO gateway_fee_reservations(
           event_key,merchant_id,request_id,kind,provider,operation,
           amount_micro_usd,state,operation_id,created_at,updated_at
         )
         SELECT ?,?,?,?,?,?,?,'HELD',?,?,?
         FROM merchants
         WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=?`,
      )
      .bind(
        eventKey,
        input.merchantId,
        input.requestId,
        input.kind,
        input.provider,
        input.operation,
        input.amountMicroUsd,
        operationId,
        now,
        now,
        input.merchantId,
        input.amountMicroUsd,
      ),
    db
      .prepare(
        `UPDATE merchants
         SET available_balance_micro_usd=available_balance_micro_usd-?,
             held_balance_micro_usd=held_balance_micro_usd+?
         WHERE merchant_id=? AND active=1
           AND EXISTS(
             SELECT 1 FROM gateway_fee_reservations
             WHERE event_key=? AND merchant_id=? AND state='HELD' AND operation_id=?
           )`,
      )
      .bind(
        input.amountMicroUsd,
        input.amountMicroUsd,
        input.merchantId,
        eventKey,
        input.merchantId,
        operationId,
      ),
  ]);

  const created = await reservation(db, eventKey);
  if (created === null) throw new Error("insufficient_service_balance");
  assertReservationMatches(created, input);
  if (created.operation_id !== operationId)
    throw new Error("gateway_event_reservation_conflict");
  return publicReservation(created);
}

export async function earnGatewayFee(
  db: D1Database,
  input: GatewayEarnInput,
): Promise<GatewayReservation> {
  const row = await requireReservation(db, input.merchantId, input.eventKey);
  if (row.state === "EARNED") return publicReservation(row);
  if (row.state !== "HELD") throw new Error("gateway_fee_not_held");
  const upstreamStatus = optionalHttpStatus(input.upstreamStatus);
  const latencyMs = nonNegativeInteger(input.latencyMs, "latency_ms");
  const requestBytes = nonNegativeInteger(
    input.requestBytes ?? 0,
    "request_bytes",
  );
  const responseBytes = nonNegativeInteger(
    input.responseBytes ?? 0,
    "response_bytes",
  );
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const eventId = `gateway:${row.event_key}`;

  await db.batch([
    db
      .prepare(
        `UPDATE gateway_fee_reservations
         SET state='EARNED',operation_id=?,updated_at=?
         WHERE event_key=? AND merchant_id=? AND state='HELD'
           AND EXISTS(
             SELECT 1 FROM merchants
             WHERE merchant_id=? AND held_balance_micro_usd>=?
           )`,
      )
      .bind(
        operationId,
        now,
        row.event_key,
        row.merchant_id,
        row.merchant_id,
        row.amount_micro_usd,
      ),
    db
      .prepare(
        `UPDATE merchants
         SET held_balance_micro_usd=held_balance_micro_usd-?
         WHERE merchant_id=? AND held_balance_micro_usd>=?
           AND EXISTS(
             SELECT 1 FROM gateway_fee_reservations
             WHERE event_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?
           )`,
      )
      .bind(
        row.amount_micro_usd,
        row.merchant_id,
        row.amount_micro_usd,
        row.event_key,
        row.merchant_id,
        operationId,
      ),
    db
      .prepare(
        `INSERT INTO gateway_usage_events(
           event_id,event_key,merchant_id,request_id,kind,provider,operation,
           fee_micro_usd,upstream_status,latency_ms,request_bytes,response_bytes,created_at
         )
         SELECT ?,event_key,merchant_id,request_id,kind,provider,operation,
                amount_micro_usd,?,?,?,?,?
         FROM gateway_fee_reservations
         WHERE event_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?`,
      )
      .bind(
        eventId,
        upstreamStatus,
        latencyMs,
        requestBytes,
        responseBytes,
        now,
        row.event_key,
        row.merchant_id,
        operationId,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at)
         SELECT ?,?,'UNEARNED_LIABILITY','DEBIT',?,?
         WHERE EXISTS(
           SELECT 1 FROM gateway_fee_reservations
           WHERE event_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?
         )`,
      )
      .bind(
        `${eventId}:debit`,
        eventId,
        row.amount_micro_usd,
        now,
        row.event_key,
        row.merchant_id,
        operationId,
      ),
    db
      .prepare(
        `INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at)
         SELECT ?,?,'EARNED_REVENUE','CREDIT',?,?
         WHERE EXISTS(
           SELECT 1 FROM gateway_fee_reservations
           WHERE event_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?
         )`,
      )
      .bind(
        `${eventId}:credit`,
        eventId,
        row.amount_micro_usd,
        now,
        row.event_key,
        row.merchant_id,
        operationId,
      ),
  ]);

  const final = await requireReservation(db, row.merchant_id, row.event_key);
  if (final.state !== "EARNED")
    throw new Error("gateway_fee_transition_race_lost");
  return publicReservation(final);
}

export async function releaseGatewayFee(
  db: D1Database,
  merchantId: string,
  eventKey: string,
): Promise<GatewayReservation> {
  const row = await requireReservation(db, merchantId, eventKey);
  if (row.state === "RELEASED") return publicReservation(row);
  if (row.state === "EARNED")
    throw new Error("earned_gateway_fee_cannot_be_released");
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `UPDATE gateway_fee_reservations
         SET state='RELEASED',operation_id=?,updated_at=?
         WHERE event_key=? AND merchant_id=? AND state='HELD'
           AND EXISTS(
             SELECT 1 FROM merchants
             WHERE merchant_id=? AND held_balance_micro_usd>=?
           )`,
      )
      .bind(
        operationId,
        now,
        eventKey,
        merchantId,
        merchantId,
        row.amount_micro_usd,
      ),
    db
      .prepare(
        `UPDATE merchants
         SET available_balance_micro_usd=available_balance_micro_usd+?,
             held_balance_micro_usd=held_balance_micro_usd-?
         WHERE merchant_id=? AND held_balance_micro_usd>=?
           AND EXISTS(
             SELECT 1 FROM gateway_fee_reservations
             WHERE event_key=? AND merchant_id=? AND state='RELEASED' AND operation_id=?
           )`,
      )
      .bind(
        row.amount_micro_usd,
        row.amount_micro_usd,
        merchantId,
        row.amount_micro_usd,
        eventKey,
        merchantId,
        operationId,
      ),
  ]);

  const final = await requireReservation(db, merchantId, eventKey);
  if (final.state !== "RELEASED")
    throw new Error("gateway_fee_transition_race_lost");
  return publicReservation(final);
}

async function reholdGatewayFee(
  db: D1Database,
  row: GatewayReservationRow,
): Promise<GatewayReservation> {
  if (row.state !== "RELEASED") throw new Error("gateway_fee_not_released");
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        `UPDATE gateway_fee_reservations
         SET state='HELD',operation_id=?,updated_at=?
         WHERE event_key=? AND merchant_id=? AND state='RELEASED'
           AND EXISTS(
             SELECT 1 FROM merchants
             WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=?
           )`,
      )
      .bind(
        operationId,
        now,
        row.event_key,
        row.merchant_id,
        row.merchant_id,
        row.amount_micro_usd,
      ),
    db
      .prepare(
        `UPDATE merchants
         SET available_balance_micro_usd=available_balance_micro_usd-?,
             held_balance_micro_usd=held_balance_micro_usd+?
         WHERE merchant_id=? AND active=1
           AND EXISTS(
             SELECT 1 FROM gateway_fee_reservations
             WHERE event_key=? AND merchant_id=? AND state='HELD' AND operation_id=?
           )`,
      )
      .bind(
        row.amount_micro_usd,
        row.amount_micro_usd,
        row.merchant_id,
        row.event_key,
        row.merchant_id,
        operationId,
      ),
  ]);
  const final = await requireReservation(db, row.merchant_id, row.event_key);
  if (final.state !== "HELD" || final.operation_id !== operationId)
    throw new Error("insufficient_service_balance");
  return publicReservation(final);
}

async function requireReservation(
  db: D1Database,
  merchantId: string,
  eventKey: string,
): Promise<GatewayReservationRow> {
  const row = await reservation(db, eventKey);
  if (row === null || row.merchant_id !== merchantId)
    throw new Error("gateway_fee_reservation_not_found");
  return row;
}

async function reservation(
  db: D1Database,
  eventKey: string,
): Promise<GatewayReservationRow | null> {
  return db
    .prepare(
      `SELECT event_key,merchant_id,request_id,kind,provider,operation,
              amount_micro_usd,state,operation_id
       FROM gateway_fee_reservations WHERE event_key=?`,
    )
    .bind(eventKey)
    .first<GatewayReservationRow>();
}

function assertReservationMatches(
  row: GatewayReservationRow,
  input: GatewayFeeInput,
): void {
  if (
    row.merchant_id !== input.merchantId ||
    row.request_id !== input.requestId ||
    row.kind !== input.kind ||
    row.provider !== input.provider ||
    row.operation !== input.operation ||
    row.amount_micro_usd !== input.amountMicroUsd
  )
    throw new Error("gateway_event_reservation_conflict");
}

function validateFeeInput(input: GatewayFeeInput): void {
  gatewayEventKey(input.merchantId, input.requestId);
  if (!/^[a-z0-9][a-z0-9._-]{0,63}$/.test(input.provider))
    throw new Error("invalid_gateway_provider");
  if (!/^[A-Za-z0-9._:/-]{1,160}$/.test(input.operation))
    throw new Error("invalid_gateway_operation");
  if (
    !Number.isSafeInteger(input.amountMicroUsd) ||
    input.amountMicroUsd <= 0 ||
    input.amountMicroUsd > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_gateway_fee");
}

function optionalHttpStatus(value: number | undefined): number | null {
  if (value === undefined) return null;
  if (!Number.isInteger(value) || value < 100 || value > 599)
    throw new Error("invalid_upstream_status");
  return value;
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0)
    throw new Error(`invalid_${field}`);
  return value;
}

function publicReservation(row: GatewayReservationRow): GatewayReservation {
  return {
    eventKey: row.event_key,
    merchantId: row.merchant_id,
    requestId: row.request_id,
    kind: row.kind,
    provider: row.provider,
    operation: row.operation,
    amountMicroUsd: row.amount_micro_usd,
    state: row.state,
  };
}
