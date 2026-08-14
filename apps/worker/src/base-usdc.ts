const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface RpcEnvelope<T> {
  jsonrpc?: unknown;
  id?: unknown;
  result?: T | null;
  error?: { code?: unknown; message?: unknown };
}

interface TransactionReceipt {
  status?: unknown;
  blockNumber?: unknown;
  logs?: unknown;
}

interface RpcBlock {
  number?: unknown;
  timestamp?: unknown;
}

interface RpcLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  logIndex?: unknown;
  removed?: unknown;
}

export interface FinalizedUsdcDeposit {
  transactionHash: string;
  sender: string;
  recipient: string;
  amountMicroUsd: number;
  blockNumber: number;
  blockTimestampSeconds: number;
  logIndex: number;
}

export async function verifyFinalizedBaseUsdcDeposit(input: {
  rpcUrl: string;
  transactionHash: string;
  treasuryAddress: string;
  usdcContractAddress: string;
  timeoutMs?: number;
}): Promise<FinalizedUsdcDeposit> {
  if (!EVM_TX_HASH.test(input.transactionHash))
    throw new Error("invalid_transaction_hash");
  if (!EVM_ADDRESS.test(input.treasuryAddress))
    throw new Error("invalid_treasury_address");
  if (!EVM_ADDRESS.test(input.usdcContractAddress))
    throw new Error("invalid_usdc_contract");

  const rpcUrl = new URL(input.rpcUrl);
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password)
    throw new Error("invalid_rpc_url");

  const [receipt, finalizedBlock] = await Promise.all([
    rpc<TransactionReceipt>(
      rpcUrl.toString(),
      "eth_getTransactionReceipt",
      [input.transactionHash],
      input.timeoutMs ?? 8_000,
    ),
    rpc<RpcBlock>(
      rpcUrl.toString(),
      "eth_getBlockByNumber",
      ["finalized", false],
      input.timeoutMs ?? 8_000,
    ),
  ]);

  if (receipt === null) throw new Error("transaction_not_found");
  if (receipt.status !== "0x1") throw new Error("transaction_not_successful");
  const blockNumber = parseRpcInteger(receipt.blockNumber, "receipt_block");
  if (finalizedBlock === null) throw new Error("finalized_block_unavailable");
  const finalizedNumber = parseRpcInteger(
    finalizedBlock.number,
    "finalized_block",
  );
  if (blockNumber > finalizedNumber)
    throw new Error("transaction_not_finalized");
  if (!Array.isArray(receipt.logs)) throw new Error("malformed_receipt_logs");

  const receiptBlock = await rpc<RpcBlock>(
    rpcUrl.toString(),
    "eth_getBlockByNumber",
    [receipt.blockNumber, false],
    input.timeoutMs ?? 8_000,
  );
  if (receiptBlock === null) throw new Error("receipt_block_unavailable");
  if (parseRpcInteger(receiptBlock.number, "receipt_block_number") !== blockNumber)
    throw new Error("receipt_block_mismatch");
  const blockTimestampSeconds = parseRpcInteger(
    receiptBlock.timestamp,
    "receipt_block_timestamp",
  );

  const treasuryTopic = addressTopic(input.treasuryAddress);
  const contract = input.usdcContractAddress.toLowerCase();
  const matches: FinalizedUsdcDeposit[] = [];

  for (const raw of receipt.logs) {
    const log = raw as RpcLog;
    if (log.removed === true) continue;
    if (
      typeof log.address !== "string" ||
      log.address.toLowerCase() !== contract
    )
      continue;
    if (!Array.isArray(log.topics) || log.topics.length < 3) continue;
    const topics = log.topics;
    if (
      typeof topics[0] !== "string" ||
      topics[0].toLowerCase() !== TRANSFER_TOPIC ||
      typeof topics[1] !== "string" ||
      typeof topics[2] !== "string" ||
      topics[2].toLowerCase() !== treasuryTopic
    )
      continue;
    const sender = topicAddress(topics[1]);
    const amount = parseRpcInteger(log.data, "usdc_amount");
    const logIndex = parseRpcInteger(log.logIndex, "log_index");
    if (amount <= 0 || !Number.isSafeInteger(amount))
      throw new Error("invalid_usdc_amount");
    matches.push({
      transactionHash: input.transactionHash.toLowerCase(),
      sender,
      recipient: input.treasuryAddress.toLowerCase(),
      amountMicroUsd: amount,
      blockNumber,
      blockTimestampSeconds,
      logIndex,
    });
  }

  if (matches.length === 0) throw new Error("treasury_usdc_transfer_not_found");
  if (matches.length !== 1)
    throw new Error("ambiguous_multiple_treasury_transfers");
  return matches[0]!;
}

async function rpc<T>(
  url: string,
  method: string,
  params: unknown[],
  timeoutMs: number,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      redirect: "error",
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`rpc_http_${response.status}`);
    const text = await response.text();
    if (text.length > 256 * 1024) throw new Error("rpc_response_too_large");
    const parsed = JSON.parse(text) as RpcEnvelope<T>;
    if (parsed.error !== undefined) throw new Error("rpc_error");
    if (!("result" in parsed)) throw new Error("malformed_rpc_response");
    return parsed.result ?? null;
  } finally {
    clearTimeout(timer);
  }
}

function addressTopic(address: string): string {
  return `0x${"0".repeat(24)}${address.slice(2).toLowerCase()}`;
}

function topicAddress(topic: string): string {
  if (!/^0x[0-9a-fA-F]{64}$/.test(topic))
    throw new Error("malformed_transfer_topic");
  return `0x${topic.slice(-40).toLowerCase()}`;
}

function parseRpcInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value))
    throw new Error(`invalid_${field}`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${field}_too_large`);
  return Number(parsed);
}
