import type { FinalizedUsdcDeposit } from "./base-usdc.js";

const MIN_TOP_UP_MICRO_USD = 10_000;
const MAX_TOP_UP_MICRO_USD = 1_000_000_000_000;
const INTENT_TTL_SECONDS = 2 * 60 * 60;
const BLOCK_CLOCK_SKEW_SECONDS = 30;
const MAX_SAFE_MICRO_USD = Number.MAX_SAFE_INTEGER;

interface MerchantRow {
  merchant_id: string;
  name: string;
  available_balance_micro_usd: number;
  held_balance_micro_usd: number;
  active: number;
}

interface TopUpIntentRow {
  intent_id: string;
  merchant_id: string;
  claim_token_hash: string;
  expected_amount_micro_usd: number;
  state: string;
  expires_at_epoch: number;
  created_at_epoch: number;
}

interface FeeReservationRow {
  logical_payment_key: string;
  merchant_id: string;
  amount_micro_usd: number;
  state: "HELD" | "EARNED" | "RELEASED" | "AMBIGUOUS" | "CREATED";
  operation_id: string | null;
}

export interface MerchantIdentity {
  merchantId: string;
  name: string;
}

export interface MerchantBalance extends MerchantIdentity {
  availableMicroUsd: number;
  heldMicroUsd: number;
}

export interface TopUpIntent {
  intentId: string;
  claimToken: string;
  amountMicroUsd: number;
  expiresAtEpoch: number;
}

export interface FeeReservation {
  logicalPaymentKey: string;
  merchantId: string;
  amountMicroUsd: number;
  state: FeeReservationRow["state"];
}

export async function registerMerchant(
  db: D1Database,
  rawName: string,
): Promise<{ merchant: MerchantBalance; apiKey: string }> {
  const name = rawName.trim();
  if (name.length < 2 || name.length > 80)
    throw new Error("invalid_merchant_name");

  const merchantId = crypto.randomUUID();
  const apiKey = `xg_live_${randomToken(32)}`;
  const apiKeyHash = await sha256(apiKey);
  const createdAt = new Date().toISOString();
  await db
    .prepare(
      "INSERT INTO merchants(merchant_id,name,api_key_hash,created_at) VALUES(?,?,?,?)",
    )
    .bind(merchantId, name, apiKeyHash, createdAt)
    .run();
  return {
    apiKey,
    merchant: {
      merchantId,
      name,
      availableMicroUsd: 0,
      heldMicroUsd: 0,
    },
  };
}

export async function authenticateMerchant(
  db: D1Database,
  apiKey: string,
): Promise<MerchantIdentity | null> {
  if (!/^xg_live_[A-Za-z0-9_-]{40,}$/.test(apiKey)) return null;
  const apiKeyHash = await sha256(apiKey);
  const row = await db
    .prepare(
      "SELECT merchant_id,name,available_balance_micro_usd,held_balance_micro_usd,active FROM merchants WHERE api_key_hash=? AND active=1",
    )
    .bind(apiKeyHash)
    .first<MerchantRow>();
  return row === null
    ? null
    : { merchantId: row.merchant_id, name: row.name };
}

export async function merchantBalance(
  db: D1Database,
  merchantId: string,
): Promise<MerchantBalance> {
  const row = await db
    .prepare(
      "SELECT merchant_id,name,available_balance_micro_usd,held_balance_micro_usd,active FROM merchants WHERE merchant_id=? AND active=1",
    )
    .bind(merchantId)
    .first<MerchantRow>();
  if (row === null) throw new Error("merchant_not_found");
  return {
    merchantId: row.merchant_id,
    name: row.name,
    availableMicroUsd: safeMoney(row.available_balance_micro_usd),
    heldMicroUsd: safeMoney(row.held_balance_micro_usd),
  };
}

export async function createTopUpIntent(
  db: D1Database,
  merchantId: string,
  requestedMicroUsd: number,
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): Promise<TopUpIntent> {
  if (
    !Number.isSafeInteger(requestedMicroUsd) ||
    requestedMicroUsd < MIN_TOP_UP_MICRO_USD ||
    requestedMicroUsd > MAX_TOP_UP_MICRO_USD
  )
    throw new Error("invalid_top_up_amount");

  await db
    .prepare(
      "UPDATE top_up_intents SET state='EXPIRED' WHERE state='OPEN' AND expires_at_epoch<?",
    )
    .bind(nowEpochSeconds)
    .run();

  const claimToken = `xg_topup_${randomToken(24)}`;
  const claimTokenHash = await sha256(claimToken);
  const expiresAtEpoch = nowEpochSeconds + INTENT_TTL_SECONDS;
  const createdAt = new Date(nowEpochSeconds * 1000).toISOString();

  for (let attempt = 0; attempt < 12; attempt += 1) {
    const suffix = 1 + randomInteger(999);
    const amountMicroUsd = requestedMicroUsd + suffix;
    if (amountMicroUsd > MAX_SAFE_MICRO_USD)
      throw new Error("top_up_amount_too_large");
    const intentId = crypto.randomUUID();
    try {
      await db
        .prepare(
          "INSERT INTO top_up_intents(intent_id,merchant_id,claim_token_hash,expected_amount_micro_usd,state,expires_at_epoch,created_at,created_at_epoch) VALUES(?,?,?,?,'OPEN',?,?,?)",
        )
        .bind(
          intentId,
          merchantId,
          claimTokenHash,
          amountMicroUsd,
          expiresAtEpoch,
          createdAt,
          nowEpochSeconds,
        )
        .run();
      return { intentId, claimToken, amountMicroUsd, expiresAtEpoch };
    } catch (error) {
      if (!String(error).includes("UNIQUE constraint failed")) throw error;
    }
  }
  throw new Error("top_up_amount_allocation_failed");
}

export async function claimTopUp(
  db: D1Database,
  input: {
    merchantId: string;
    claimToken: string;
    deposit: FinalizedUsdcDeposit;
    network: "eip155:8453";
    asset: string;
  },
  nowEpochSeconds = Math.floor(Date.now() / 1000),
): Promise<MerchantBalance> {
  const claimTokenHash = await sha256(input.claimToken);
  const intent = await db
    .prepare(
      "SELECT intent_id,merchant_id,claim_token_hash,expected_amount_micro_usd,state,expires_at_epoch,created_at_epoch FROM top_up_intents WHERE merchant_id=? AND claim_token_hash=?",
    )
    .bind(input.merchantId, claimTokenHash)
    .first<TopUpIntentRow>();
  if (intent === null || intent.state !== "OPEN")
    throw new Error("top_up_intent_unavailable");
  if (intent.expires_at_epoch < nowEpochSeconds)
    throw new Error("top_up_intent_expired");
  if (intent.expected_amount_micro_usd !== input.deposit.amountMicroUsd)
    throw new Error("top_up_amount_mismatch");
  if (
    input.deposit.blockTimestampSeconds + BLOCK_CLOCK_SKEW_SECONDS <
    intent.created_at_epoch
  )
    throw new Error("top_up_predates_intent");

  const operationId = crypto.randomUUID();
  const topUpId = crypto.randomUUID();
  const createdAt = new Date(nowEpochSeconds * 1000).toISOString();
  const externalReference = `${input.network}:${input.deposit.transactionHash}:${input.deposit.logIndex}`;
  const asset = input.asset.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(asset))
    throw new Error("invalid_top_up_asset");
  const eventId = `topup:${topUpId}`;

  await db.batch([
    db
      .prepare(
        "UPDATE top_up_intents SET state='CLAIMED',claimed_at=?,claim_operation_id=? WHERE intent_id=? AND merchant_id=? AND claim_token_hash=? AND state='OPEN' AND expires_at_epoch>=? AND expected_amount_micro_usd=?",
      )
      .bind(
        createdAt,
        operationId,
        intent.intent_id,
        input.merchantId,
        claimTokenHash,
        nowEpochSeconds,
        input.deposit.amountMicroUsd,
      ),
    db
      .prepare(
        "INSERT INTO top_ups(top_up_id,intent_id,merchant_id,external_reference,network,asset,transaction_hash,transfer_log_index,payer,treasury_address,amount_micro_usd,finalized_block,created_at) SELECT ?,intent_id,merchant_id,?,?,?,?,?,?,?,?,?,?,? FROM top_up_intents WHERE intent_id=? AND merchant_id=? AND state='CLAIMED' AND claim_operation_id=?",
      )
      .bind(
        topUpId,
        externalReference,
        input.network,
        asset,
        input.deposit.transactionHash,
        input.deposit.logIndex,
        input.deposit.sender,
        input.deposit.recipient,
        input.deposit.amountMicroUsd,
        input.deposit.blockNumber,
        createdAt,
        intent.intent_id,
        input.merchantId,
        operationId,
      ),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd+? WHERE merchant_id=? AND active=1 AND EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=? AND merchant_id=?)",
      )
      .bind(
        input.deposit.amountMicroUsd,
        input.merchantId,
        topUpId,
        input.merchantId,
      ),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'CUSTOMER_BALANCES','DEBIT',?,? WHERE EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=?)",
      )
      .bind(
        `${eventId}:debit`,
        eventId,
        input.deposit.amountMicroUsd,
        createdAt,
        topUpId,
      ),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'UNEARNED_LIABILITY','CREDIT',?,? WHERE EXISTS(SELECT 1 FROM top_ups WHERE top_up_id=?)",
      )
      .bind(
        `${eventId}:credit`,
        eventId,
        input.deposit.amountMicroUsd,
        createdAt,
        topUpId,
      ),
  ]);

  const credited = await db
    .prepare("SELECT top_up_id FROM top_ups WHERE top_up_id=? AND merchant_id=?")
    .bind(topUpId, input.merchantId)
    .first<{ top_up_id: string }>();
  if (credited === null) throw new Error("top_up_claim_race_lost");
  return merchantBalance(db, input.merchantId);
}

export async function reserveSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
  amountMicroUsd: number,
): Promise<FeeReservation> {
  validateFee(amountMicroUsd);
  const existing = await reservation(db, logicalPaymentKey);
  if (existing !== null) {
    if (existing.merchant_id !== merchantId)
      throw new Error("payment_reservation_conflict");
    return publicReservation(existing);
  }

  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "INSERT OR IGNORE INTO fee_reservations(logical_payment_key,merchant_id,amount_micro_usd,state,created_at,updated_at,operation_id) SELECT ?,?,?,'HELD',?,?,? FROM merchants WHERE merchant_id=? AND active=1 AND available_balance_micro_usd>=?",
      )
      .bind(
        logicalPaymentKey,
        merchantId,
        amountMicroUsd,
        now,
        now,
        operationId,
        merchantId,
        amountMicroUsd,
      ),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd-?,held_balance_micro_usd=held_balance_micro_usd+? WHERE merchant_id=? AND active=1 AND EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='HELD' AND operation_id=?)",
      )
      .bind(
        amountMicroUsd,
        amountMicroUsd,
        merchantId,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
  ]);

  const created = await reservation(db, logicalPaymentKey);
  if (created === null) throw new Error("insufficient_service_balance");
  if (created.merchant_id !== merchantId)
    throw new Error("payment_reservation_conflict");
  return publicReservation(created);
}

export async function markSettlementFeeAmbiguous(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  return transitionNoMoney(
    db,
    merchantId,
    logicalPaymentKey,
    "HELD",
    "AMBIGUOUS",
  );
}

export async function releaseSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  const row = await requireReservation(db, merchantId, logicalPaymentKey);
  if (row.state === "RELEASED") return publicReservation(row);
  if (row.state === "EARNED") throw new Error("earned_fee_cannot_be_released");
  if (row.state !== "HELD" && row.state !== "AMBIGUOUS")
    throw new Error("invalid_fee_transition");
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.batch([
    db
      .prepare(
        "UPDATE fee_reservations SET state='RELEASED',updated_at=?,operation_id=? WHERE logical_payment_key=? AND merchant_id=? AND state IN ('HELD','AMBIGUOUS')",
      )
      .bind(now, operationId, logicalPaymentKey, merchantId),
    db
      .prepare(
        "UPDATE merchants SET available_balance_micro_usd=available_balance_micro_usd+?,held_balance_micro_usd=held_balance_micro_usd-? WHERE merchant_id=? AND held_balance_micro_usd>=? AND EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='RELEASED' AND operation_id=?)",
      )
      .bind(
        row.amount_micro_usd,
        row.amount_micro_usd,
        merchantId,
        row.amount_micro_usd,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
  ]);
  const final = await requireReservation(db, merchantId, logicalPaymentKey);
  if (final.state !== "RELEASED") throw new Error("fee_transition_race_lost");
  return publicReservation(final);
}

export async function earnSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  const row = await requireReservation(db, merchantId, logicalPaymentKey);
  if (row.state === "EARNED") return publicReservation(row);
  if (row.state === "RELEASED")
    throw new Error("released_fee_cannot_be_earned");
  if (row.state !== "HELD" && row.state !== "AMBIGUOUS")
    throw new Error("invalid_fee_transition");
  const operationId = crypto.randomUUID();
  const now = new Date().toISOString();
  const eventId = `fee:${logicalPaymentKey}`;
  await db.batch([
    db
      .prepare(
        "UPDATE fee_reservations SET state='EARNED',updated_at=?,operation_id=? WHERE logical_payment_key=? AND merchant_id=? AND state IN ('HELD','AMBIGUOUS')",
      )
      .bind(now, operationId, logicalPaymentKey, merchantId),
    db
      .prepare(
        "UPDATE merchants SET held_balance_micro_usd=held_balance_micro_usd-? WHERE merchant_id=? AND held_balance_micro_usd>=? AND EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        row.amount_micro_usd,
        merchantId,
        row.amount_micro_usd,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
    db
      .prepare(
        "INSERT INTO usage_events(event_id,logical_payment_key,kind,fee_micro_usd,created_at) SELECT ?,?,'SUCCESSFUL_BILLABLE_SETTLEMENT',?,? WHERE EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        eventId,
        logicalPaymentKey,
        row.amount_micro_usd,
        now,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'UNEARNED_LIABILITY','DEBIT',?,? WHERE EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        `${eventId}:debit`,
        eventId,
        row.amount_micro_usd,
        now,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
    db
      .prepare(
        "INSERT INTO ledger_entries(entry_id,event_id,account,side,amount_micro_usd,created_at) SELECT ?,?,'EARNED_REVENUE','CREDIT',?,? WHERE EXISTS(SELECT 1 FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=? AND state='EARNED' AND operation_id=?)",
      )
      .bind(
        `${eventId}:credit`,
        eventId,
        row.amount_micro_usd,
        now,
        logicalPaymentKey,
        merchantId,
        operationId,
      ),
  ]);
  const final = await requireReservation(db, merchantId, logicalPaymentKey);
  if (final.state !== "EARNED") throw new Error("fee_transition_race_lost");
  return publicReservation(final);
}

async function transitionNoMoney(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
  from: "HELD",
  to: "AMBIGUOUS",
): Promise<FeeReservation> {
  const row = await requireReservation(db, merchantId, logicalPaymentKey);
  if (row.state === to) return publicReservation(row);
  if (row.state !== from) return publicReservation(row);
  await db
    .prepare(
      "UPDATE fee_reservations SET state=?,updated_at=?,operation_id=? WHERE logical_payment_key=? AND merchant_id=? AND state=?",
    )
    .bind(
      to,
      new Date().toISOString(),
      crypto.randomUUID(),
      logicalPaymentKey,
      merchantId,
      from,
    )
    .run();
  return publicReservation(
    await requireReservation(db, merchantId, logicalPaymentKey),
  );
}

async function requireReservation(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservationRow> {
  const row = await reservation(db, logicalPaymentKey);
  if (row === null || row.merchant_id !== merchantId)
    throw new Error("fee_reservation_not_found");
  return row;
}

async function reservation(
  db: D1Database,
  logicalPaymentKey: string,
): Promise<FeeReservationRow | null> {
  return db
    .prepare(
      "SELECT logical_payment_key,merchant_id,amount_micro_usd,state,operation_id FROM fee_reservations WHERE logical_payment_key=?",
    )
    .bind(logicalPaymentKey)
    .first<FeeReservationRow>();
}

function publicReservation(row: FeeReservationRow): FeeReservation {
  return {
    logicalPaymentKey: row.logical_payment_key,
    merchantId: row.merchant_id,
    amountMicroUsd: safeMoney(row.amount_micro_usd),
    state: row.state,
  };
}

function validateFee(value: number): void {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    value > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_fee_amount");
}

function safeMoney(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 0 ||
    value > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_money_value");
  return value;
}

function randomInteger(maxExclusive: number): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0]! % maxExclusive;
}

function randomToken(bytes: number): string {
  const values = new Uint8Array(bytes);
  crypto.getRandomValues(values);
  let binary = "";
  for (const value of values) binary += String.fromCharCode(value);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
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
