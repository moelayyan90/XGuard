export * from "./mainnet-billing-legacy.js";

import {
  releaseSettlementFee as legacyReleaseSettlementFee,
  type FeeReservation,
} from "./mainnet-billing-legacy.js";

/**
 * Attempt fees are earned before downstream execution. Once a logical payment
 * has been charged, later settlement/finality failure must not refund that
 * accepted-attempt fee. Legacy callers still invoke releaseSettlementFee on
 * definitive failures, so make release idempotent for already-earned fees.
 */
export async function releaseSettlementFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<FeeReservation> {
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
