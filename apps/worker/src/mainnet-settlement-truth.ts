import { verifyFinalizedBaseUsdcSettlement } from "./base-settlement.js";
import {
  recoverAmbiguousSettlements,
  type MainnetRecoveryEnv,
} from "./mainnet-recovery.js";
import { BASE_MAINNET, BASE_USDC } from "./mainnet-protocol.js";

const PERMANENT_FINALITY_FAILURES = new Set([
  "transaction_failed_finalized",
  "expected_usdc_transfer_not_found",
  "ambiguous_expected_usdc_transfer",
]);

export type SettlementTruthState =
  "FINALIZED" | "PENDING" | "PROVEN_FAILED" | "CONFLICT";

export interface SettlementTruthEnv extends MainnetRecoveryEnv {
  DB: D1Database;
}

interface FinalityTruthRow {
  logical_payment_key: string;
  merchant_id: string;
  transaction_hash: string;
  network: string;
  asset: string;
  expected_payer: string;
  expected_pay_to: string;
  expected_amount_micro_usd: number;
  state: "PENDING" | "CONFIRMED" | "FAILED" | "AMBIGUOUS";
  attempts: number;
  last_error_code: string | null;
  updated_at: string;
  confirmed_at: string | null;
}

interface RecoveryTruthRow {
  logical_payment_key: string;
  merchant_id: string;
  expected_payer: string;
  expected_pay_to: string;
  expected_amount_micro_usd: number;
  state: "PENDING" | "CONFIRMED" | "CANCELED" | "EXPIRED" | "FAILED";
  transaction_hash: string | null;
  attempts: number;
  last_error_code: string | null;
  updated_at: string;
  resolved_at: string | null;
}

type FinalityStateEvidence = Pick<
  FinalityTruthRow,
  "state" | "confirmed_at" | "last_error_code"
>;
type RecoveryStateEvidence = Pick<RecoveryTruthRow, "state">;

export interface SettlementTruth {
  version: "xguard-settlement-truth-v1";
  logicalPaymentKey: string;
  state: SettlementTruthState;
  authoritativeForRelease: boolean;
  network: string;
  asset: string;
  payer: string;
  payTo: string;
  amountMicroUsd: number;
  transactionHash: string | null;
  source: "finality" | "recovery" | "combined";
  reason: string;
  observedAt: string;
  proofDigest: string | null;
}

export async function settlementTruthResponse(
  request: Request,
  env: SettlementTruthEnv,
  merchantId: string,
): Promise<Response | null> {
  const url = new URL(request.url);
  const match = url.pathname.match(
    /^\/v1\/settlements\/([0-9a-fA-F]{64})\/(truth|resolve)$/,
  );
  if (match === null) return null;

  const logicalPaymentKey = match[1]!.toLowerCase();
  const action = match[2]!;
  if (action === "truth" && request.method !== "GET")
    return methodNotAllowed("GET");
  if (action === "resolve" && request.method !== "POST")
    return methodNotAllowed("POST");

  if (action === "resolve") {
    await prioritizeRecovery(env.DB, merchantId, logicalPaymentKey);
    await recoverAmbiguousSettlements(env).catch(() => undefined);
    await refreshPendingFinality(env, merchantId, logicalPaymentKey).catch(
      () => undefined,
    );
  }

  const truth = await settlementTruthForMerchant(
    env.DB,
    merchantId,
    logicalPaymentKey,
  );
  if (truth === null)
    return jsonResponse(
      {
        error: "settlement_truth_not_found",
        logicalPaymentKey,
      },
      404,
    );

  return jsonResponse(
    {
      ...truth,
      truthEndpoint: `/v1/settlements/${logicalPaymentKey}/truth`,
      resolveEndpoint: `/v1/settlements/${logicalPaymentKey}/resolve`,
    },
    truth.state === "PENDING" ? 202 : 200,
    truth.state === "PENDING" ? { "Retry-After": "5" } : {},
  );
}

export async function settlementTruthForMerchant(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<SettlementTruth | null> {
  assertLogicalPaymentKey(logicalPaymentKey);
  const [finality, recovery] = await Promise.all([
    loadFinalityTruth(db, logicalPaymentKey, merchantId),
    loadRecoveryTruth(db, logicalPaymentKey, merchantId),
  ]);

  if (finality === null && recovery === null) return null;
  const state = classifySettlementTruth(finality, recovery);
  const source: SettlementTruth["source"] =
    finality !== null && recovery !== null
      ? "combined"
      : recovery !== null
        ? "recovery"
        : "finality";
  const evidence = recovery ?? finality!;
  const transactionHash =
    recovery?.transaction_hash ?? finality?.transaction_hash ?? null;
  const observedAt =
    recovery?.resolved_at ??
    finality?.confirmed_at ??
    recovery?.updated_at ??
    finality?.updated_at ??
    new Date().toISOString();
  const reason = truthReason(state, finality, recovery);
  const base: Omit<SettlementTruth, "proofDigest"> = {
    version: "xguard-settlement-truth-v1",
    logicalPaymentKey,
    state,
    authoritativeForRelease: state === "FINALIZED",
    network: finality?.network ?? BASE_MAINNET,
    asset: finality?.asset ?? BASE_USDC.toLowerCase(),
    payer: evidence.expected_payer.toLowerCase(),
    payTo: evidence.expected_pay_to.toLowerCase(),
    amountMicroUsd: evidence.expected_amount_micro_usd,
    transactionHash,
    source,
    reason,
    observedAt,
  };

  return {
    ...base,
    proofDigest:
      state === "FINALIZED" || state === "PROVEN_FAILED"
        ? await digestTruth(base)
        : null,
  };
}

export async function settlementTruthStateForPayment(
  db: D1Database,
  logicalPaymentKey: string,
): Promise<SettlementTruthState | null> {
  assertLogicalPaymentKey(logicalPaymentKey);
  const [finality, recovery] = await Promise.all([
    db
      .prepare(
        `SELECT state,confirmed_at,last_error_code
         FROM settlement_finality_jobs WHERE logical_payment_key=?`,
      )
      .bind(logicalPaymentKey)
      .first<FinalityStateEvidence>(),
    db
      .prepare(
        `SELECT state FROM settlement_recovery_jobs WHERE logical_payment_key=?`,
      )
      .bind(logicalPaymentKey)
      .first<RecoveryStateEvidence>(),
  ]);
  if (finality === null && recovery === null) return null;
  return classifySettlementTruth(finality, recovery);
}

export function classifySettlementTruth(
  finality: FinalityStateEvidence | null,
  recovery: RecoveryStateEvidence | null,
): SettlementTruthState {
  const finalitySuccess =
    finality !== null &&
    (finality.state === "CONFIRMED" || finality.confirmed_at !== null);
  const finalityFailure =
    finality !== null &&
    (finality.state === "FAILED" ||
      (finality.last_error_code !== null &&
        PERMANENT_FINALITY_FAILURES.has(finality.last_error_code)));
  const recoverySuccess = recovery?.state === "CONFIRMED";
  const recoveryFailure =
    recovery?.state === "CANCELED" ||
    recovery?.state === "EXPIRED" ||
    recovery?.state === "FAILED";

  if (
    (finalitySuccess || recoverySuccess) &&
    (finalityFailure || recoveryFailure)
  )
    return "CONFLICT";
  if (finalitySuccess || recoverySuccess) return "FINALIZED";
  if (finalityFailure || recoveryFailure) return "PROVEN_FAILED";
  return "PENDING";
}

async function loadFinalityTruth(
  db: D1Database,
  logicalPaymentKey: string,
  merchantId: string,
): Promise<FinalityTruthRow | null> {
  return db
    .prepare(
      `SELECT logical_payment_key,merchant_id,transaction_hash,network,asset,
        expected_payer,expected_pay_to,expected_amount_micro_usd,state,attempts,
        last_error_code,updated_at,confirmed_at
       FROM settlement_finality_jobs
       WHERE logical_payment_key=? AND merchant_id=?`,
    )
    .bind(logicalPaymentKey, merchantId)
    .first<FinalityTruthRow>();
}

async function loadRecoveryTruth(
  db: D1Database,
  logicalPaymentKey: string,
  merchantId: string,
): Promise<RecoveryTruthRow | null> {
  return db
    .prepare(
      `SELECT logical_payment_key,merchant_id,expected_payer,expected_pay_to,
        expected_amount_micro_usd,state,transaction_hash,attempts,last_error_code,
        updated_at,resolved_at
       FROM settlement_recovery_jobs
       WHERE logical_payment_key=? AND merchant_id=?`,
    )
    .bind(logicalPaymentKey, merchantId)
    .first<RecoveryTruthRow>();
}

async function prioritizeRecovery(
  db: D1Database,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE settlement_recovery_jobs
       SET updated_at='1970-01-01T00:00:00.000Z'
       WHERE logical_payment_key=? AND merchant_id=? AND state='PENDING'`,
    )
    .bind(logicalPaymentKey, merchantId)
    .run();
}

async function refreshPendingFinality(
  env: SettlementTruthEnv,
  merchantId: string,
  logicalPaymentKey: string,
): Promise<void> {
  const row = await env.DB.prepare(
    `SELECT logical_payment_key,merchant_id,transaction_hash,network,asset,
      expected_payer,expected_pay_to,expected_amount_micro_usd,state,attempts,
      last_error_code,updated_at,confirmed_at
     FROM settlement_finality_jobs
     WHERE logical_payment_key=? AND merchant_id=? AND state='PENDING'`,
  )
    .bind(logicalPaymentKey, merchantId)
    .first<FinalityTruthRow>();
  if (row === null) return;

  const now = new Date().toISOString();
  try {
    await verifyFinalizedBaseUsdcSettlement({
      rpcUrl: env.BASE_RPC_URL,
      transactionHash: row.transaction_hash,
      usdcContractAddress: row.asset,
      expectedPayer: row.expected_payer,
      expectedPayTo: row.expected_pay_to,
      expectedAmountMicroUsd: row.expected_amount_micro_usd,
    });
    await env.DB.prepare(
      `UPDATE settlement_finality_jobs
       SET confirmed_at=COALESCE(confirmed_at,?),last_error_code=NULL,
           attempts=attempts+1,updated_at=?
       WHERE logical_payment_key=? AND merchant_id=? AND state='PENDING'`,
    )
      .bind(now, now, logicalPaymentKey, merchantId)
      .run();
  } catch (error) {
    const code = errorCode(error);
    await env.DB.prepare(
      `UPDATE settlement_finality_jobs
       SET last_error_code=?,attempts=attempts+1,updated_at=?
       WHERE logical_payment_key=? AND merchant_id=? AND state='PENDING'`,
    )
      .bind(code, now, logicalPaymentKey, merchantId)
      .run();
  }
}

function truthReason(
  state: SettlementTruthState,
  finality: FinalityTruthRow | null,
  recovery: RecoveryTruthRow | null,
): string {
  if (state === "FINALIZED")
    return recovery?.state === "CONFIRMED"
      ? "late_or_ambiguous_settlement_proven_on_base"
      : "expected_usdc_transfer_finalized_on_base";
  if (state === "PROVEN_FAILED")
    return (
      recovery?.last_error_code ??
      finality?.last_error_code ??
      recovery?.state.toLowerCase() ??
      finality?.state.toLowerCase() ??
      "settlement_proven_failed"
    );
  if (state === "CONFLICT") return "conflicting_settlement_evidence";
  return (
    recovery?.last_error_code ??
    finality?.last_error_code ??
    "awaiting_independent_finality_evidence"
  );
}

async function digestTruth(
  value: Omit<SettlementTruth, "proofDigest">,
): Promise<string> {
  const canonical = [
    value.version,
    value.logicalPaymentKey,
    value.state,
    value.network.toLowerCase(),
    value.asset.toLowerCase(),
    value.payer.toLowerCase(),
    value.payTo.toLowerCase(),
    String(value.amountMicroUsd),
    value.transactionHash?.toLowerCase() ?? "",
  ].join("|");
  const hash = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(hash)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function methodNotAllowed(method: string): Response {
  return jsonResponse({ error: "method_not_allowed", allowed: [method] }, 405, {
    Allow: method,
  });
}

function jsonResponse(
  value: unknown,
  status = 200,
  extraHeaders: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...extraHeaders,
    },
  });
}

function assertLogicalPaymentKey(value: string): void {
  if (!/^[0-9a-f]{64}$/.test(value)) throw new Error("invalid_payment_key");
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_finality_error";
  return error.name === "AbortError"
    ? "AbortError"
    : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
