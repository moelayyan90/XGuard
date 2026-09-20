import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";
import { receiptConfirmsAuthorization } from "./settlement-proof.js";
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
export function reconciliationRpcUrls(env, network = "eip155:8453") {
  if (!["eip155:8453", "eip155:84532"].includes(network)) return [];
  const testnet = network === "eip155:84532";
  const configured = testnet ? env.BASE_SEPOLIA_RPC_URL : env.BASE_RPC_URL;
  let fallbacks; try { fallbacks = JSON.parse((testnet ? env.BASE_SEPOLIA_RPC_FALLBACKS : env.BASE_RPC_FALLBACKS) || "[]"); } catch { return []; }
  if (!Array.isArray(fallbacks)) return [];
  return [...new Set([configured || (testnet ? "https://sepolia.base.org" : "https://mainnet.base.org"), ...fallbacks])].filter(endpoint => {
    try { const url = new URL(endpoint); return url.protocol === "https:" && !url.username && !url.password; } catch { return false; }
  }).slice(0, 3);
}

export async function reconciliationRpcHealth(env) {
  try {
    await Promise.any(reconciliationRpcUrls(env).map(async endpoint => {
      const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }), redirect: "manual", signal: AbortSignal.timeout(2000) });
      if (!response.ok || (await response.json()).result !== "0x2105") throw new Error("rpc_chain_unavailable");
    }));
    return { ready: true, status: "ready" };
  } catch { return { ready: false, status: "unavailable" }; }
}

// Read-only recovery. An ambiguous /settle is never submitted again, even to the same provider.
export async function reconcilePayment(env, record) {
  const testnet = record.network === "eip155:84532";
  const endpoints = reconciliationRpcUrls(env, record.network);
  for (const endpoint of endpoints) {
    try {
      const url = new URL(endpoint);
      if (url.protocol !== "https:" || url.username || url.password) continue;
      const client = createPublicClient({ chain: testnet ? baseSepolia : base, transport: http(endpoint, { timeout: 5000, retryCount: 0 }) });
      if (await client.getChainId() !== (testnet ? 84532 : 8453)) continue;
      let transaction = record.observed_transaction;
      if (!/^0x[a-fA-F0-9]{64}$/.test(transaction || "")) {
        const latest = await client.getBlockNumber();
        const logs = await client.getLogs({ address: record.asset, event: AUTH_USED, args: { authorizer: record.payer, nonce: record.nonce }, fromBlock: latest > 1800n ? latest - 1800n : 0n, toBlock: latest });
        transaction = logs.at(-1)?.transactionHash;
      }
      if (!transaction) continue;
      const receipt = await client.getTransactionReceipt({ hash: transaction });
      if (receiptConfirmsAuthorization(receipt, { asset: record.asset, from: record.payer, nonce: record.nonce, payTo: record.pay_to, amount: record.amount })) return { success: true, transaction, network: record.network, payer: record.payer };
    } catch { /* Try the next explicitly configured read-only RPC, never another settlement. */ }
  }
  return null; // Missing evidence is unresolved, not proof of failure or permission to execute.
}
