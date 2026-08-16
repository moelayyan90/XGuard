import type { SettleResponse } from "@x402/core/types";
import { earnSettlementFee, releaseSettlementFee } from "./mainnet-billing.js";
import {
  BASE_MAINNET,
  BASE_USDC,
} from "./mainnet-protocol.js";
import { verifyFinalizedBaseUsdcSettlement } from "./base-settlement.js";

const AUTHORIZATION_USED_TOPIC =
  "0x98de503528ee59b575ef0c0a2576a82497bfc029a5685b209e9ec333479b10a5";
const AUTHORIZATION_CANCELED_TOPIC =
  "0x1cdd46ff242716cdaa72d159d339a485b3438398348d68f09d7c8c0a59353d81";
const RECOVERY_LOOKBACK_BLOCKS = 65_536;
const LOG_BLOCK_CHUNK = 2_000;
const RECOVERY_BATCH_SIZE = 12;
const RPC_RESPONSE_LIMIT = 256 * 1024;

export interface AmbiguousRecoveryInput {
  logicalPaymentKey: string;
  merchantId: string;
  expectedPayer: string;
  expectedPayTo: string;
  expectedAmountMicroUsd: number;
  authorizationNonce: string;
  validBeforeEpoch: number;
}

export interface MainnetRecoveryEnv {
  DB: D1Database;
  BASE_RPC_URL: string;
  XGUARD_FEE_MICRO_USD: string;
  XPAY_DOWNSTREAM_COST_MICRO_USD?: string;
  PAYAI_DOWNSTREAM_COST_MICRO_USD?: string;
}

interface RecoveryRow {
  logical_payment_key: string;
  merchant_id: string;
  expected_payer: string;
  expected_pay_to: string;
  expected_amount_micro_usd: number;
  authorization_nonce: string;
  valid_before_epoch: number;
  from_block: number | null;
  state: "PENDING" | "CONFIRMED" | "CANCELED" | "EXPIRED" | "FAILED";
  transaction_hash: string | null;
  result_json: string | null;
  attempts: number;
}

interface RpcEnvelope<T> {
  result?: T | null;
  error?: unknown;
}

interface RpcBlock {
  number?: unknown;
  timestamp?: unknown;
}

interface RpcLog {
  transactionHash?: unknown;
  blockNumber?: unknown;
  logIndex?: unknown;
  topics?: unknown;
  removed?: unknown;
}

export async function recordAmbiguousRecovery(
  db: D1Database,
  input: AmbiguousRecoveryInput,
): Promise<void> {
  validateRecoveryInput(input);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO settlement_recovery_jobs(
        logical_payment_key,merchant_id,expected_payer,expected_pay_to,
        expected_amount_micro_usd,authorization_nonce,valid_before_epoch,
        from_block,state,created_at,updated_at
      ) VALUES(?,?,?,?,?,?,?,NULL,'PENDING',?,?)
      ON CONFLICT(logical_payment_key) DO NOTHING`,
    )
    .bind(
      input.logicalPaymentKey,
      input.merchantId,
      input.expectedPayer.toLowerCase(),
      input.expectedPayTo.toLowerCase(),
      input.expectedAmountMicroUsd,
      input.authorizationNonce.toLowerCase(),
      input.validBeforeEpoch,
      now,
      now,
    )
    .run();
}

export async function recoveredSettlement(
  db: D1Database,
  logicalPaymentKey: string,
): Promise<{
  state: RecoveryRow["state"];
  result: SettleResponse | null;
} | null> {
  const row = await db
    .prepare(
      "SELECT state,result_json FROM settlement_recovery_jobs WHERE logical_payment_key=?",
    )
    .bind(logicalPaymentKey)
    .first<{ state: RecoveryRow["state"]; result_json: string | null }>();
  if (row === null) return null;
  return {
    state: row.state,
    result:
      row.result_json === null
        ? null
        : (JSON.parse(row.result_json) as SettleResponse),
  };
}

export async function recoveryStats(db: D1Database): Promise<{
  pending: number;
  failed: number;
}> {
  const rows = await db
    .prepare(
      "SELECT state,COUNT(*) AS count FROM settlement_recovery_jobs WHERE state IN ('PENDING','FAILED') GROUP BY state",
    )
    .all<{ state: "PENDING" | "FAILED"; count: number }>();
  let pending = 0;
  let failed = 0;
  for (const row of rows.results) {
    if (row.state === "PENDING") pending = row.count;
    if (row.state === "FAILED") failed = row.count;
  }
  return { pending, failed };
}

export async function recoverAmbiguousSettlements(
  env: MainnetRecoveryEnv,
): Promise<void> {
  const finalized = await finalizedBlock(env.BASE_RPC_URL);
  const jobs = await env.DB.prepare(
    `SELECT logical_payment_key,merchant_id,expected_payer,expected_pay_to,
      expected_amount_micro_usd,authorization_nonce,valid_before_epoch,
      from_block,state,transaction_hash,result_json,attempts
     FROM settlement_recovery_jobs
     WHERE state='PENDING'
     ORDER BY updated_at
     LIMIT ?`,
  )
    .bind(RECOVERY_BATCH_SIZE)
    .all<RecoveryRow>();

  for (const job of jobs.results) {
    await recoverOne(env, job, finalized).catch(async (error) => {
      await markAttempt(env.DB, job.logical_payment_key, errorCode(error));
    });
  }
}

async function recoverOne(
  env: MainnetRecoveryEnv,
  job: RecoveryRow,
  finalized: { number: number; timestamp: number },
): Promise<void> {
  const fromBlock =
    job.from_block ?? Math.max(0, finalized.number - RECOVERY_LOOKBACK_BLOCKS);
  if (job.from_block === null) {
    await env.DB.prepare(
      "UPDATE settlement_recovery_jobs SET from_block=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
    )
      .bind(fromBlock, new Date().toISOString(), job.logical_payment_key)
      .run();
  }

  const topicAuthorizer = addressTopic(job.expected_payer);
  const topics = [topicAuthorizer, job.authorization_nonce.toLowerCase()];
  const used = await scanLogs(
    env.BASE_RPC_URL,
    AUTHORIZATION_USED_TOPIC,
    topics,
    fromBlock,
    finalized.number,
  );
  const canceled = await scanLogs(
    env.BASE_RPC_URL,
    AUTHORIZATION_CANCELED_TOPIC,
    topics,
    fromBlock,
    finalized.number,
  );

  if (used.length > 0 && canceled.length > 0) {
    await failRecovery(env, job, "authorization_used_and_canceled_conflict");
    return;
  }

  if (used.length > 0) {
    const transactionHashes = [...new Set(used.map((entry) => entry.transactionHash))];
    const verified: string[] = [];
    for (const transactionHash of transactionHashes) {
      try {
        await verifyFinalizedBaseUsdcSettlement({
          rpcUrl: env.BASE_RPC_URL,
          transactionHash,
          usdcContractAddress: BASE_USDC,
          expectedPayer: job.expected_payer,
          expectedPayTo: job.expected_pay_to,
          expectedAmountMicroUsd: job.expected_amount_micro_usd,
        });
        verified.push(transactionHash);
      } catch {
        // A used authorization that does not prove the exact expected transfer is
        // never accepted as a successful XGuard settlement.
      }
    }
    if (verified.length === 1) {
      await confirmRecovery(env, job, verified[0]!);
      return;
    }
    if (verified.length > 1) {
      await failRecovery(env, job, "multiple_verified_settlement_transactions");
      return;
    }
    await failRecovery(env, job, "authorization_used_without_expected_transfer");
    return;
  }

  if (canceled.length > 0) {
    await closeWithoutCharge(env, job, "CANCELED", "authorization_canceled");
    return;
  }

  if (finalized.timestamp >= job.valid_before_epoch) {
    await closeWithoutCharge(env, job, "EXPIRED", "authorization_expired_unused");
    return;
  }

  await markAttempt(env.DB, job.logical_payment_key, "authorization_still_pending");
}

async function confirmRecovery(
  env: MainnetRecoveryEnv,
  job: RecoveryRow,
  transactionHash: string,
): Promise<void> {
  const result = {
    success: true,
    transaction: transactionHash,
    network: BASE_MAINNET,
    payer: job.expected_payer,
    amount: String(job.expected_amount_micro_usd),
  } as SettleResponse;
  const now = new Date().toISOString();
  const fee = boundedMoney(env.XGUARD_FEE_MICRO_USD, "XGUARD_FEE_MICRO_USD");
  const downstream = boundedMoney(
    env.XPAY_DOWNSTREAM_COST_MICRO_USD ??
      env.PAYAI_DOWNSTREAM_COST_MICRO_USD ??
      "0",
    "XPAY_DOWNSTREAM_COST_MICRO_USD",
  );

  await env.DB.prepare(
    `UPDATE settlement_projection
     SET state='SETTLED',transaction_hash=?,fee_micro_usd=?,downstream_cost_micro_usd=?,recorded_at=?
     WHERE logical_payment_key=?`,
  )
    .bind(transactionHash, fee, downstream, now, job.logical_payment_key)
    .run();
  await earnSettlementFee(env.DB, job.merchant_id, job.logical_payment_key);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE settlement_recovery_jobs
       SET state='CONFIRMED',transaction_hash=?,result_json=?,attempts=attempts+1,
           last_error_code=NULL,updated_at=?,resolved_at=?
       WHERE logical_payment_key=? AND state='PENDING'`,
    ).bind(
      transactionHash,
      JSON.stringify(result),
      now,
      now,
      job.logical_payment_key,
    ),
    env.DB.prepare(
      "UPDATE reconciliation_cases SET state='RESOLVED',resolved_at=? WHERE logical_payment_key=? AND state='OPEN'",
    ).bind(now, job.logical_payment_key),
  ]);
}

async function closeWithoutCharge(
  env: MainnetRecoveryEnv,
  job: RecoveryRow,
  state: "CANCELED" | "EXPIRED",
  reason: string,
): Promise<void> {
  const result = {
    success: false,
    transaction: "",
    network: BASE_MAINNET,
    errorReason: `xguard_${reason}`,
    errorMessage: "The ambiguous authorization can no longer settle on-chain",
  } as SettleResponse;
  const now = new Date().toISOString();
  await releaseSettlementFee(
    env.DB,
    job.merchant_id,
    job.logical_payment_key,
  ).catch(() => undefined);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE settlement_recovery_jobs
       SET state=?,result_json=?,attempts=attempts+1,last_error_code=?,updated_at=?,resolved_at=?
       WHERE logical_payment_key=? AND state='PENDING'`,
    ).bind(
      state,
      JSON.stringify(result),
      reason,
      now,
      now,
      job.logical_payment_key,
    ),
    env.DB.prepare(
      "UPDATE settlement_projection SET state='FAILED',fee_micro_usd=0,recorded_at=? WHERE logical_payment_key=?",
    ).bind(now, job.logical_payment_key),
    env.DB.prepare(
      "UPDATE reconciliation_cases SET state='RESOLVED',resolved_at=? WHERE logical_payment_key=? AND state='OPEN'",
    ).bind(now, job.logical_payment_key),
  ]);
}

async function failRecovery(
  env: MainnetRecoveryEnv,
  job: RecoveryRow,
  reason: string,
): Promise<void> {
  const result = {
    success: false,
    transaction: "",
    network: BASE_MAINNET,
    errorReason: "xguard_recovery_conflict",
    errorMessage: "On-chain recovery evidence conflicts with the expected payment",
  } as SettleResponse;
  const now = new Date().toISOString();
  await releaseSettlementFee(
    env.DB,
    job.merchant_id,
    job.logical_payment_key,
  ).catch(() => undefined);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE settlement_recovery_jobs
       SET state='FAILED',result_json=?,attempts=attempts+1,last_error_code=?,updated_at=?,resolved_at=?
       WHERE logical_payment_key=? AND state='PENDING'`,
    ).bind(
      JSON.stringify(result),
      reason,
      now,
      now,
      job.logical_payment_key,
    ),
    env.DB.prepare(
      "UPDATE settlement_projection SET state='FAILED',fee_micro_usd=0,recorded_at=? WHERE logical_payment_key=?",
    ).bind(now, job.logical_payment_key),
  ]);
}

async function scanLogs(
  rpcUrl: string,
  eventTopic: string,
  indexedTopics: [string, string],
  fromBlock: number,
  toBlock: number,
): Promise<Array<{ transactionHash: string; blockNumber: number }>> {
  const matches: Array<{ transactionHash: string; blockNumber: number }> = [];
  for (let start = fromBlock; start <= toBlock; start += LOG_BLOCK_CHUNK) {
    const end = Math.min(toBlock, start + LOG_BLOCK_CHUNK - 1);
    const logs = await rpc<RpcLog[]>(rpcUrl, "eth_getLogs", [
      {
        address: BASE_USDC,
        fromBlock: hex(start),
        toBlock: hex(end),
        topics: [eventTopic, indexedTopics[0], indexedTopics[1]],
      },
    ]);
    if (!Array.isArray(logs)) throw new Error("malformed_recovery_logs");
    for (const log of logs) {
      if (log.removed === true) continue;
      if (
        typeof log.transactionHash !== "string" ||
        !/^0x[0-9a-fA-F]{64}$/.test(log.transactionHash)
      )
        throw new Error("malformed_recovery_transaction_hash");
      matches.push({
        transactionHash: log.transactionHash.toLowerCase(),
        blockNumber: parseRpcInteger(log.blockNumber, "recovery_log_block"),
      });
    }
  }
  return matches;
}

async function finalizedBlock(
  rpcUrl: string,
): Promise<{ number: number; timestamp: number }> {
  const block = await rpc<RpcBlock>(rpcUrl, "eth_getBlockByNumber", [
    "finalized",
    false,
  ]);
  if (block === null) throw new Error("finalized_block_unavailable");
  return {
    number: parseRpcInteger(block.number, "finalized_block"),
    timestamp: parseRpcInteger(block.timestamp, "finalized_timestamp"),
  };
}

async function rpc<T>(
  rawUrl: string,
  method: string,
  params: unknown[],
): Promise<T | null> {
  const url = new URL(rawUrl);
  if (url.protocol !== "https:" || url.username || url.password)
    throw new Error("invalid_recovery_rpc_url");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 8_000);
  try {
    const response = await fetch(url.toString(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`recovery_rpc_http_${response.status}`);
    const text = await response.text();
    if (text.length > RPC_RESPONSE_LIMIT)
      throw new Error("recovery_rpc_response_too_large");
    const parsed = JSON.parse(text) as RpcEnvelope<T>;
    if (parsed.error !== undefined) throw new Error("recovery_rpc_error");
    if (!("result" in parsed)) throw new Error("malformed_recovery_rpc_response");
    return parsed.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

async function markAttempt(
  db: D1Database,
  logicalPaymentKey: string,
  code: string,
): Promise<void> {
  await db.prepare(
    "UPDATE settlement_recovery_jobs SET attempts=attempts+1,last_error_code=?,updated_at=? WHERE logical_payment_key=? AND state='PENDING'",
  )
    .bind(code.slice(0, 96), new Date().toISOString(), logicalPaymentKey)
    .run();
}

function validateRecoveryInput(input: AmbiguousRecoveryInput): void {
  if (!/^[a-f0-9]{64}$/i.test(input.logicalPaymentKey))
    throw new Error("invalid_recovery_payment_key");
  for (const address of [input.expectedPayer, input.expectedPayTo]) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(address))
      throw new Error("invalid_recovery_address");
  }
  if (
    !Number.isSafeInteger(input.expectedAmountMicroUsd) ||
    input.expectedAmountMicroUsd <= 0
  )
    throw new Error("invalid_recovery_amount");
  if (!/^0x[0-9a-fA-F]{64}$/.test(input.authorizationNonce))
    throw new Error("invalid_recovery_nonce");
  if (!Number.isSafeInteger(input.validBeforeEpoch) || input.validBeforeEpoch <= 0)
    throw new Error("invalid_recovery_expiry");
}

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function parseRpcInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value))
    throw new Error(`invalid_${field}`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${field}_too_large`);
  return Number(parsed);
}

function boundedMoney(value: string, field: string): number {
  if (!/^[0-9]+$/.test(value)) throw new Error(`${field}_invalid`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 1_000_000)
    throw new Error(`${field}_invalid`);
  return parsed;
}

function hex(value: number): string {
  return `0x${value.toString(16)}`;
}

function errorCode(error: unknown): string {
  if (!(error instanceof Error)) return "unknown_recovery_error";
  return error.name === "AbortError"
    ? "AbortError"
    : error.message.slice(0, 96).replace(/[^a-zA-Z0-9_.:-]/g, "_");
}
