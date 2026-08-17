import type { FinalizedUsdcDeposit } from "./base-usdc.js";

const ZERO_FRICTION_PREFIX = "zf_";
const MAX_SAFE_MICRO_USD = Number.MAX_SAFE_INTEGER;

export interface ZeroFrictionPricingTerms {
  pricingVersion: string;
  feeBps: number;
  feeCapMicroUsd: number;
  postpaidLimitMicroUsd: number;
}

export interface ZeroFrictionAccount extends ZeroFrictionPricingTerms {
  merchantId: string;
  payTo: string;
  accruedMicroUsd: number;
  paidMicroUsd: number;
  dueMicroUsd: number;
  creditMicroUsd: number;
}

export function isZeroFrictionMerchantId(merchantId: string): boolean {
  return merchantId.startsWith(ZERO_FRICTION_PREFIX);
}

export function normalizeZeroFrictionPayTo(value: string): string {
  const normalized = value.toLowerCase();
  if (!/^0x[0-9a-f]{40}$/.test(normalized))
    throw new Error("invalid_zero_friction_pay_to");
  return normalized;
}

export function validateZeroFrictionPricingTerms(
  terms: ZeroFrictionPricingTerms,
): ZeroFrictionPricingTerms {
  if (!/^[a-z0-9._-]{1,64}$/i.test(terms.pricingVersion))
    throw new Error("invalid_zero_friction_pricing_version");
  if (
    !Number.isInteger(terms.feeBps) ||
    terms.feeBps < 0 ||
    terms.feeBps > 10_000
  )
    throw new Error("invalid_zero_friction_fee_bps");
  if (
    !Number.isSafeInteger(terms.feeCapMicroUsd) ||
    terms.feeCapMicroUsd < 0 ||
    terms.feeCapMicroUsd > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_zero_friction_fee_cap");
  if (
    !Number.isSafeInteger(terms.postpaidLimitMicroUsd) ||
    terms.postpaidLimitMicroUsd < 1 ||
    terms.postpaidLimitMicroUsd > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_zero_friction_postpaid_limit");
  return terms;
}

export function calculateZeroFrictionFeeMicroUsd(
  amountMicroUsd: number,
  feeBps: number,
  feeCapMicroUsd: number,
): number {
  if (!Number.isSafeInteger(amountMicroUsd) || amountMicroUsd < 0)
    throw new Error("invalid_zero_friction_settlement_amount");
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 10_000)
    throw new Error("invalid_zero_friction_fee_bps");
  if (
    !Number.isSafeInteger(feeCapMicroUsd) ||
    feeCapMicroUsd < 0 ||
    feeCapMicroUsd > MAX_SAFE_MICRO_USD
  )
    throw new Error("invalid_zero_friction_fee_cap");

  const proportional =
    (BigInt(amountMicroUsd) * BigInt(feeBps)) / BigInt(10_000);
  const capped =
    proportional < BigInt(feeCapMicroUsd)
      ? proportional
      : BigInt(feeCapMicroUsd);
  return Number(capped);
}

export async function zeroFrictionMerchantId(
  rawPayTo: string,
): Promise<string> {
  const payTo = normalizeZeroFrictionPayTo(rawPayTo);
  const digest = await sha256Hex(payTo);
  return `${ZERO_FRICTION_PREFIX}${digest.slice(0, 40)}`;
}

/**
 * Creates the postpaid account only after the caller has independently proven
 * control of payTo and signed the exact pricing terms. Never call this from
 * /verify or /settle.
 */
export async function activateZeroFrictionMerchant(
  db: D1Database,
  rawPayTo: string,
  rawTerms: ZeroFrictionPricingTerms,
): Promise<ZeroFrictionAccount> {
  const payTo = normalizeZeroFrictionPayTo(rawPayTo);
  const terms = validateZeroFrictionPricingTerms(rawTerms);
  const merchantId = await zeroFrictionMerchantId(payTo);
  const disabledCredentialHash = await sha256Hex(
    `zero-friction-disabled-credential:${payTo}`,
  );
  const now = new Date().toISOString();

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO merchants(
          merchant_id,name,api_key_hash,available_balance_micro_usd,
          held_balance_micro_usd,active,created_at
        ) VALUES(?,?,?,0,0,1,?)`,
      )
      .bind(merchantId, `zero-friction:${payTo}`, disabledCredentialHash, now),
    db
      .prepare(
        `INSERT INTO zero_friction_accounts(
          pay_to,merchant_id,pricing_version,fee_bps,fee_cap_micro_usd,
          postpaid_limit_micro_usd,accrued_micro_usd,paid_micro_usd,
          claimed_at,created_at,updated_at
        ) VALUES(?,?,?,?,?,?,0,0,?,?,?)
        ON CONFLICT(pay_to) DO UPDATE SET
          pricing_version=excluded.pricing_version,
          fee_bps=excluded.fee_bps,
          fee_cap_micro_usd=excluded.fee_cap_micro_usd,
          postpaid_limit_micro_usd=excluded.postpaid_limit_micro_usd,
          claimed_at=excluded.claimed_at,
          updated_at=excluded.updated_at`,
      )
      .bind(
        payTo,
        merchantId,
        terms.pricingVersion,
        terms.feeBps,
        terms.feeCapMicroUsd,
        terms.postpaidLimitMicroUsd,
        now,
        now,
        now,
      ),
  ]);

  return zeroFrictionAccount(db, payTo);
}

export async function zeroFrictionAccountOrNull(
  db: D1Database,
  rawPayTo: string,
): Promise<ZeroFrictionAccount | null> {
  const payTo = normalizeZeroFrictionPayTo(rawPayTo);
  const row = await db
    .prepare(
      `SELECT merchant_id,pay_to,pricing_version,fee_bps,fee_cap_micro_usd,
              postpaid_limit_micro_usd,accrued_micro_usd,paid_micro_usd
       FROM zero_friction_accounts WHERE pay_to=?`,
    )
    .bind(payTo)
    .first<{
      merchant_id: string;
      pay_to: string;
      pricing_version: string;
      fee_bps: number;
      fee_cap_micro_usd: number;
      postpaid_limit_micro_usd: number;
      accrued_micro_usd: number;
      paid_micro_usd: number;
    }>();
  if (row === null) return null;
  const accrued = safeMoney(row.accrued_micro_usd);
  const paid = safeMoney(row.paid_micro_usd);
  const terms = validateZeroFrictionPricingTerms({
    pricingVersion: row.pricing_version,
    feeBps: row.fee_bps,
    feeCapMicroUsd: row.fee_cap_micro_usd,
    postpaidLimitMicroUsd: row.postpaid_limit_micro_usd,
  });
  return {
    merchantId: row.merchant_id,
    payTo: row.pay_to,
    ...terms,
    accruedMicroUsd: accrued,
    paidMicroUsd: paid,
    dueMicroUsd: Math.max(0, accrued - paid),
    creditMicroUsd: Math.max(0, paid - accrued),
  };
}

export async function zeroFrictionAccount(
  db: D1Database,
  rawPayTo: string,
): Promise<ZeroFrictionAccount> {
  const account = await zeroFrictionAccountOrNull(db, rawPayTo);
  if (account === null) throw new Error("zero_friction_activation_required");
  return account;
}

/** Compatibility name used by the x402 request path. It no longer creates an
 * account; it only returns a wallet that completed signed activation. */
export async function ensureZeroFrictionMerchant(
  db: D1Database,
  rawPayTo: string,
): Promise<ZeroFrictionAccount> {
  return zeroFrictionAccount(db, rawPayTo);
}

export async function zeroFrictionAccountByMerchant(
  db: D1Database,
  merchantId: string,
): Promise<ZeroFrictionAccount | null> {
  if (!isZeroFrictionMerchantId(merchantId)) return null;
  const row = await db
    .prepare("SELECT pay_to FROM zero_friction_accounts WHERE merchant_id=?")
    .bind(merchantId)
    .first<{ pay_to: string }>();
  return row === null ? null : zeroFrictionAccount(db, row.pay_to);
}

export async function accrueZeroFrictionFee(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<{ amountMicroUsd: number }> {
  const account = await zeroFrictionAccountByMerchant(db, merchantId);
  if (account === null) throw new Error("zero_friction_activation_required");
  const projection = await db
    .prepare(
      `SELECT fee_micro_usd,state FROM settlement_projection
       WHERE logical_payment_key=?`,
    )
    .bind(logicalPaymentKey)
    .first<{ fee_micro_usd: number; state: string }>();
  if (projection === null || projection.state !== "SETTLED")
    throw new Error("zero_friction_finality_not_confirmed");
  const feeMicroUsd = safeMoney(projection.fee_micro_usd);
  if (feeMicroUsd === 0) return { amountMicroUsd: 0 };
  const now = new Date().toISOString();
  const eventId = `zf-fee:${logicalPaymentKey}`;

  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO zero_friction_fee_events(
          logical_payment_key,merchant_id,pay_to,fee_micro_usd,created_at
        ) VALUES(?,?,?,?,?)`,
      )
      .bind(logicalPaymentKey, merchantId, account.payTo, feeMicroUsd, now),
    db
      .prepare(
        `INSERT OR IGNORE INTO usage_events(
          event_id,logical_payment_key,kind,fee_micro_usd,created_at
        ) VALUES(?,?,'SUCCESSFUL_BILLABLE_SETTLEMENT',?,?)`,
      )
      .bind(eventId, logicalPaymentKey, feeMicroUsd, now),
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

  return { amountMicroUsd: feeMicroUsd };
}

export async function recordZeroFrictionPayment(
  db: D1Database,
  rawPayTo: string,
  deposit: FinalizedUsdcDeposit,
): Promise<ZeroFrictionAccount> {
  const account = await zeroFrictionAccount(db, rawPayTo);
  if (deposit.amountMicroUsd <= 0)
    throw new Error("zero_friction_payment_amount_invalid");

  const now = new Date().toISOString();
  const paymentId = `zf-pay:${deposit.transactionHash.toLowerCase()}:${deposit.logIndex}`;
  await db.batch([
    db
      .prepare(
        `INSERT OR IGNORE INTO zero_friction_payments(
          payment_id,merchant_id,pay_to,network,transaction_hash,transfer_log_index,
          sender,amount_micro_usd,finalized_block,created_at
        ) VALUES(?,?,?,'eip155:8453',?,?,?,?,?,?)`,
      )
      .bind(
        paymentId,
        account.merchantId,
        account.payTo,
        deposit.transactionHash.toLowerCase(),
        deposit.logIndex,
        deposit.sender.toLowerCase(),
        deposit.amountMicroUsd,
        deposit.blockNumber,
        now,
      ),
    db
      .prepare(
        `UPDATE zero_friction_accounts
         SET paid_micro_usd=(
           SELECT COALESCE(SUM(amount_micro_usd),0)
           FROM zero_friction_payments
           WHERE merchant_id=zero_friction_accounts.merchant_id
         ),updated_at=?
         WHERE merchant_id=?`,
      )
      .bind(now, account.merchantId),
  ]);
  return zeroFrictionAccount(db, account.payTo);
}

function safeMoney(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_SAFE_MICRO_USD)
    throw new Error("invalid_zero_friction_money");
  return value;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}
