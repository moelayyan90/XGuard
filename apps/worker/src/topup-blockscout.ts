import { BASE_USDC } from "./mainnet-protocol.js";
import {
  creditAutomaticTopUpDeposit,
  type AutomaticTopUpDeposit,
} from "./mainnet-revenue-hardening.js";

const BASE_BLOCKSCOUT_ORIGIN = "https://base.blockscout.com";
const TOPUP_INDEXER_FINALITY_SECONDS = 20 * 60;
const TOPUP_INDEXER_RECOVERY_GRACE_SECONDS = 6 * 60 * 60;
const TOPUP_INDEXER_CLOCK_SKEW_SECONDS = 30;
const TOPUP_INDEXER_MAX_PAGES = 20;
const TOPUP_INDEXER_MAX_RESPONSE_BYTES = 512 * 1024;

type BlockscoutEnv = {
  DB: D1Database;
  XGUARD_TREASURY_USDC_ADDRESS: string;
};

interface BlockscoutTransferPage {
  items: unknown[];
  next_page_params?: unknown;
}

export async function scanAutomaticTopUpsFromBlockscout(
  env: BlockscoutEnv,
  nowEpochSeconds = Math.floor(Date.now() / 1_000),
): Promise<{ scannedThroughBlock: number; credited: number }> {
  const treasury = normalizedAddress(
    env.XGUARD_TREASURY_USDC_ADDRESS,
    "treasury",
  );
  const recoveryCutoff = nowEpochSeconds - TOPUP_INDEXER_RECOVERY_GRACE_SECONDS;
  const intentWindow = await env.DB.prepare(
    `SELECT MIN(created_at_epoch) AS earliest_created_at_epoch
       FROM top_up_intents
       WHERE state IN ('OPEN','EXPIRED')
         AND expires_at_epoch>=?`,
  )
    .bind(recoveryCutoff)
    .first<{ earliest_created_at_epoch: number | null }>();
  const cursor = await readCursor(env.DB);
  if (intentWindow?.earliest_created_at_epoch == null)
    return { scannedThroughBlock: cursor, credited: 0 };

  const oldestNeededTimestamp =
    intentWindow.earliest_created_at_epoch - TOPUP_INDEXER_CLOCK_SKEW_SECONDS;
  const finalityCutoff = nowEpochSeconds - TOPUP_INDEXER_FINALITY_SECONDS;
  let nextPage: Record<string, string> | null = {};
  let reachedOldestNeeded = false;
  let credited = 0;
  let scannedThroughBlock = cursor;

  for (
    let pageIndex = 0;
    pageIndex < TOPUP_INDEXER_MAX_PAGES && nextPage !== null;
    pageIndex += 1
  ) {
    const page = await fetchTransferPage(treasury, nextPage);
    for (const raw of page.items) {
      const deposit = parseBlockscoutTransferItem(raw, treasury);
      if (deposit.blockTimestampSeconds < oldestNeededTimestamp) {
        reachedOldestNeeded = true;
        break;
      }
      if (deposit.blockTimestampSeconds > finalityCutoff) continue;
      if (deposit.amountMicroUsd <= 0) continue;
      if (await creditAutomaticTopUpDeposit(env.DB, deposit)) credited += 1;
      scannedThroughBlock = Math.max(scannedThroughBlock, deposit.blockNumber);
    }
    if (reachedOldestNeeded) break;
    nextPage = parseNextPageParams(page.next_page_params);
    if (nextPage === null) reachedOldestNeeded = true;
  }

  if (!reachedOldestNeeded) throw new Error("blockscout_pagination_limit");

  if (scannedThroughBlock > cursor)
    await env.DB.prepare(
      `INSERT INTO treasury_scan_state(scanner_id,last_scanned_block,updated_at)
         VALUES('base-usdc',?,?)
         ON CONFLICT(scanner_id) DO UPDATE SET
           last_scanned_block=excluded.last_scanned_block,
           updated_at=excluded.updated_at`,
    )
      .bind(scannedThroughBlock, new Date().toISOString())
      .run();

  return { scannedThroughBlock, credited };
}

export function parseBlockscoutTransferItem(
  value: unknown,
  treasuryAddress: string,
): AutomaticTopUpDeposit {
  const item = record(value, "blockscout_transfer");
  const treasury = normalizedAddress(treasuryAddress, "treasury");
  const token = record(item.token, "blockscout_token");
  const tokenAddress = normalizedAddress(
    token.address_hash,
    "blockscout_token_address",
  );
  if (tokenAddress !== BASE_USDC.toLowerCase())
    throw new Error("blockscout_wrong_token");
  if (token.type !== "ERC-20") throw new Error("blockscout_wrong_token_type");

  const to = record(item.to, "blockscout_to");
  if (normalizedAddress(to.hash, "blockscout_recipient") !== treasury)
    throw new Error("blockscout_wrong_recipient");
  const from = record(item.from, "blockscout_from");
  const sender = normalizedAddress(from.hash, "blockscout_sender");

  const transactionHash = item.transaction_hash;
  if (
    typeof transactionHash !== "string" ||
    !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
  )
    throw new Error("blockscout_invalid_transaction_hash");

  const total = record(item.total, "blockscout_total");
  const decimals = token.decimals ?? total.decimals;
  if (String(decimals) !== "6")
    throw new Error("blockscout_unexpected_usdc_decimals");

  return {
    transactionHash: transactionHash.toLowerCase(),
    sender,
    recipient: treasury,
    amountMicroUsd: safeInteger(total.value, "blockscout_amount"),
    blockNumber: safeInteger(item.block_number, "blockscout_block_number"),
    blockTimestampSeconds: parseTimestamp(item.timestamp),
    logIndex: safeInteger(item.log_index, "blockscout_log_index"),
  };
}

export function isTransientBlockscoutFailure(
  error: unknown,
  normalizedCode?: string,
): boolean {
  const code =
    normalizedCode ??
    (error instanceof Error ? error.message : "blockscout_unknown_error");
  return (
    /^(blockscout_http_(403|408|425|429|500|502|503|504)|blockscout_network_error|blockscout_timeout)$/.test(
      code,
    ) ||
    (error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

async function fetchTransferPage(
  treasury: string,
  nextPage: Record<string, string>,
): Promise<BlockscoutTransferPage> {
  const url = new URL(
    `/api/v2/addresses/${treasury}/token-transfers`,
    BASE_BLOCKSCOUT_ORIGIN,
  );
  url.searchParams.set("type", "ERC-20");
  url.searchParams.set("filter", "to");
  url.searchParams.set("token", BASE_USDC);
  for (const [key, value] of Object.entries(nextPage))
    url.searchParams.set(key, value);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      method: "GET",
      headers: {
        Accept: "application/json",
        "Cache-Control": "no-cache",
      },
      redirect: "manual",
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    )
      throw new Error("blockscout_timeout");
    throw new Error("blockscout_network_error");
  }
  if (!response.ok) throw new Error(`blockscout_http_${response.status}`);

  const advertisedLength = Number(
    response.headers.get("content-length") ?? "0",
  );
  if (
    Number.isFinite(advertisedLength) &&
    advertisedLength > TOPUP_INDEXER_MAX_RESPONSE_BYTES
  )
    throw new Error("blockscout_response_too_large");
  const text = await response.text();
  if (
    new TextEncoder().encode(text).byteLength > TOPUP_INDEXER_MAX_RESPONSE_BYTES
  )
    throw new Error("blockscout_response_too_large");

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error("blockscout_invalid_json");
  }
  const page = record(parsed, "blockscout_page");
  if (!Array.isArray(page.items)) throw new Error("blockscout_invalid_items");
  return {
    items: page.items,
    next_page_params: page.next_page_params,
  };
}

function parseNextPageParams(value: unknown): Record<string, string> | null {
  if (value == null) return null;
  const input = record(value, "blockscout_next_page");
  const output: Record<string, string> = {};
  for (const key of ["block_number", "index", "items_count"] as const) {
    const candidate = input[key];
    if (
      (typeof candidate === "number" &&
        Number.isSafeInteger(candidate) &&
        candidate >= 0) ||
      (typeof candidate === "string" && /^\d+$/.test(candidate))
    )
      output[key] = String(candidate);
  }
  return Object.keys(output).length === 0 ? null : output;
}

async function readCursor(db: D1Database): Promise<number> {
  const row = await db
    .prepare(
      "SELECT last_scanned_block FROM treasury_scan_state WHERE scanner_id='base-usdc'",
    )
    .first<{ last_scanned_block: number }>();
  if (row === null) return 0;
  if (
    !Number.isSafeInteger(row.last_scanned_block) ||
    row.last_scanned_block < 0
  )
    throw new Error("invalid_treasury_scan_cursor");
  return row.last_scanned_block;
}

function parseTimestamp(value: unknown): number {
  if (typeof value !== "string")
    throw new Error("blockscout_invalid_timestamp");
  const milliseconds = Date.parse(value);
  if (!Number.isFinite(milliseconds) || milliseconds < 0)
    throw new Error("blockscout_invalid_timestamp");
  return Math.floor(milliseconds / 1_000);
}

function safeInteger(value: unknown, label: string): number {
  let parsed: bigint;
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0)
      throw new Error(`${label}_invalid`);
    return value;
  }
  if (typeof value !== "string" || !/^\d+$/.test(value))
    throw new Error(`${label}_invalid`);
  parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${label}_unsafe`);
  return Number(parsed);
}

function normalizedAddress(value: unknown, label: string): string {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value))
    throw new Error(`${label}_invalid`);
  return value.toLowerCase();
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value))
    throw new Error(`${label}_invalid`);
  return value as Record<string, unknown>;
}
