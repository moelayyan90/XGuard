export * from "./mainnet-billing-legacy.js";

import {
  earnSettlementFee as legacyEarnSettlementFee,
  releaseSettlementFee as legacyReleaseSettlementFee,
  type FeeReservation,
} from "./mainnet-billing-legacy.js";
import {
  accrueZeroFrictionFee,
  isZeroFrictionMerchantId,
} from "./zero-friction-billing.js";

/**
 * Zero-friction merchants never prepay and never carry a request-time fee hold.
 * Their fee is accrued only after the independent finality processor has moved
 * settlement_projection to SETTLED. Legacy authenticated merchants retain the
 * prior reservation model for backwards compatibility.
 */
export async function earnSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
  if (isZeroFrictionMerchantId(merchantId)) {
    const accrued = await accrueZeroFrictionFee(
      db,
      merchantId,
      logicalPaymentKey,
    );
    return {
      logicalPaymentKey,
      merchantId,
      amountMicroUsd: accrued.amountMicroUsd,
      state: "EARNED",
    };
  }
  return legacyEarnSettlementFee(db, merchantId, logicalPaymentKey);
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
