export * from "./mainnet-billing-legacy.js";

import {
  earnSettlementFee as legacyEarnSettlementFee,
  releaseSettlementFee as legacyReleaseSettlementFee,
  type FeeReservation,
} from "./mainnet-billing-legacy.js";
import {
  calculateZeroFrictionFeeMicroUsd,
  isZeroFrictionMerchantId,
  zeroFrictionAccountByMerchant,
} from "./zero-friction-billing.js";

/**
 * Zero-friction merchants never prepay and never carry a request-time fee hold.
 * Their fee is calculated from the merchant's signed pricing terms only after
 * independent finality has moved settlement_projection to SETTLED.
 */
export async function earnSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  if (isZeroFrictionMerchantId(merchantId)) {
    return earnZeroFrictionSettlementFee(db, merchantId, logicalPaymentKey);
  }
  return legacyEarnSettlementFee(db, merchantId, logicalPaymentKey);
}

async function earnZeroFrictionSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  const account = await zeroFrictionAccountByMerchant(db, merchantId);
  if (account === null) throw new Error("zero_friction_activation_required");

  const row = await db
    .prepare(
      `SELECT p.state,f.expected_amount_micro_usd
       FROM settlement_projection p
       JOIN settlement_finality_jobs f
         ON f.logical_payment_key=p.logical_payment_key
       WHERE p.logical_payment_key=? AND f.merchant_id=?`,
    )
    .bind(logicalPaymentKey, merchantId)
    .first<{ state: string; expected_amount_micro_usd: number }>();
  if (row === null || row.state !== "SETTLED")
    throw new Error("zero_friction_finality_not_confirmed");

  const amountMicroUsd = calculateZeroFrictionFeeMicroUsd(
    row.expected_amount_micro_usd,
    account.feeBps,
    account.feeCapMicroUsd,
  );
  const now = new Date().toISOString();

  if (amountMicroUsd === 0) {
    await db
      .prepare(
        `UPDATE settlement_projection
         SET fee_micro_usd=0,recorded_at=?
         WHERE logical_payment_key=? AND state='SETTLED'`,
      )
      .bind(now, logicalPaymentKey)
      .run();
    return {
      logicalPaymentKey,
      merchantId,
      amountMicroUsd: 0,
      state: "EARNED",
    };
  }

  const eventId = `zf-fee:${logicalPaymentKey}`;
  await db.batch([
    db
      .prepare(
        `UPDATE settlement_projection
         SET fee_micro_usd=?,recorded_at=?
         WHERE logical_payment_key=? AND state='SETTLED'`,
      )
      .bind(amountMicroUsd, now, logicalPaymentKey),
    db
      .prepare(
        `INSERT OR IGNORE INTO zero_friction_fee_events(
          logical_payment_key,merchant_id,pay_to,fee_micro_usd,created_at
        ) VALUES(?,?,?,?,?)`,
      )
      .bind(logicalPaymentKey, merchantId, account.payTo, amountMicroUsd, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO usage_events(
          event_id,logical_payment_key,kind,fee_micro_usd,created_at
        ) VALUES(?,?,'SUCCESSFUL_BILLABLE_SETTLEMENT',?,?)`,
      )
      .bind(eventId, logicalPaymentKey, amountMicroUsd, now),
    db
      .prepare(
        `UPDATE zero_friction_accounts
         SET accrued_micro_usd=(
           SELECT COALESCE(SUM(fee_micro_usd),0)
           FROM zero_friction_fee_events
           WHERE merchant_id=zero_friction_accounts.merchant_id
         ),updated_at=?
         WHERE merchant_id=?`,
      )
      .bind(now, merchantId),
  ]);

  return {
    logicalPaymentKey,
    merchantId,
    amountMicroUsd,
    state: "EARNED",
  };
}

/**
 * Zero-friction fees do not exist until finality, so failures and ambiguous
 * attempts have nothing to refund. Legacy callers still use the original
 * prepaid release path.
 */
export async function releaseSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  if (isZeroFrictionMerchantId(merchantId)) {
    return {
      logicalPaymentKey,
      merchantId,
      amountMicroUsd: 0,
      state: "RELEASED",
    };
  }

  const row = await db
    .prepare(
      "SELECT amount_micro_usd,state FROM fee_reservations WHERE logical_payment_key=? AND merchant_id=?",
    )
    .bind(logicalPaymentKey, merchantId)
    .first<{ amount_micro_usd: number; state: string }>();

  if (row?.state === "EARNED") {
    return {
      logicalPaymentKey,
      merchantId,
      amountMicroUsd: row.amount_micro_usd,
      state: "EARNED",
    };
  }

  return legacyReleaseSettlementFee(db, merchantId, logicalPaymentKey);
}
