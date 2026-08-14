const EVM_TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;
const TRANSFER_TOPIC =
  "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

interface RpcEnvelope<T> {
  result?: T | null;
  error?: unknown;
}

interface TransactionReceipt {
  status?: unknown;
  blockNumber?: unknown;
  logs?: unknown;
}

interface RpcBlock {
  number?: unknown;
}

interface RpcLog {
  address?: unknown;
  topics?: unknown;
  data?: unknown;
  logIndex?: unknown;
  removed?: unknown;
}

export interface FinalizedSettlementEvidence {
  transactionHash: string;
  blockNumber: number;
  logIndex: number;
}

export async function verifyFinalizedBaseUsdcSettlement(input: {
  rpcUrl: string;
  transactionHash: string;
  usdcContractAddress: string;
  expectedPayer: string;
  expectedPayTo: string;
  expectedAmountMicroUsd: number;
  timeoutMs?: number;
}): Promise<FinalizedSettlementEvidence> {
  if (!EVM_TX_HASH.test(input.transactionHash))
    throw new Error("invalid_transaction_hash");
  for (const [label, address] of [
    ["usdc_contract", input.usdcContractAddress],
    ["expected_payer", input.expectedPayer],
    ["expected_pay_to", input.expectedPayTo],
  ] as const) {
    if (!EVM_ADDRESS.test(address)) throw new Error(`invalid_${label}`);
  }
  if (
    !Number.isSafeInteger(input.expectedAmountMicroUsd) ||
    input.expectedAmountMicroUsd <= 0
  )
    throw new Error("invalid_expected_amount");

  const rpcUrl = new URL(input.rpcUrl);
  if (rpcUrl.protocol !== "https:" || rpcUrl.username || rpcUrl.password)
    throw new Error("invalid_rpc_url");

  const timeout = input.timeoutMs ?? 8_000;
  const [receipt, finalizedBlock] = await Promise.all([
    rpc<TransactionReceipt>(
      rpcUrl.toString(),
      "eth_getTransactionReceipt",
      [input.transactionHash],
      timeout,
    ),
    rpc<RpcBlock>(
      rpcUrl.toString(),
      "eth_getBlockByNumber",
      ["finalized", false],
      timeout,
    ),
  ]);
  if (receipt === null) throw new Error("transaction_not_found");
  if (receipt.status !== "0x1") throw new Error("transaction_failed_finalized");
  const blockNumber = parseRpcInteger(receipt.blockNumber, "receipt_block");
  if (finalizedBlock === null) throw new Error("finalized_block_unavailable");
  const finalizedNumber = parseRpcInteger(
    finalizedBlock.number,
    "finalized_block",
  );
  if (blockNumber > finalizedNumber)
    throw new Error("transaction_not_finalized");
  if (!Array.isArray(receipt.logs)) throw new Error("malformed_receipt_logs");

  const contract = input.usdcContractAddress.toLowerCase();
  const payerTopic = addressTopic(input.expectedPayer);
  const payToTopic = addressTopic(input.expectedPayTo);
  const matches: FinalizedSettlementEvidence[] = [];
  for (const raw of receipt.logs) {
    const log = raw as RpcLog;
    if (log.removed === true) continue;
    if (
      typeof log.address !== "string" ||
      log.address.toLowerCase() !== contract ||
      !Array.isArray(log.topics) ||
      log.topics.length < 3 ||
      typeof log.topics[0] !== "string" ||
      typeof log.topics[1] !== "string" ||
      typeof log.topics[2] !== "string" ||
      log.topics[0].toLowerCase() !== TRANSFER_TOPIC ||
      log.topics[1].toLowerCase() !== payerTopic ||
      log.topics[2].toLowerCase() !== payToTopic
    )
      continue;
    const amount = parseRpcInteger(log.data, "transfer_amount");
    if (amount !== input.expectedAmountMicroUsd) continue;
    matches.push({
      transactionHash: input.transactionHash.toLowerCase(),
      blockNumber,
      logIndex: parseRpcInteger(log.logIndex, "log_index"),
    });
  }
  if (matches.length === 0) throw new Error("expected_usdc_transfer_not_found");
  if (matches.length !== 1) throw new Error("ambiguous_expected_usdc_transfer");
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

function parseRpcInteger(value: unknown, field: string): number {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]+$/.test(value))
    throw new Error(`invalid_${field}`);
  const parsed = BigInt(value);
  if (parsed > BigInt(Number.MAX_SAFE_INTEGER))
    throw new Error(`${field}_too_large`);
  return Number(parsed);
}
