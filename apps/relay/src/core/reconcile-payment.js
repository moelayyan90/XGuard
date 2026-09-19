import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";
import { receiptConfirmsAuthorization } from "./settlement-proof.js";
const AUTH_USED = parseAbiItem("event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)");
// Read-only recovery. An ambiguous /settle is never submitted again, even to the same provider.
export async function reconcilePayment(env, record) {
  const testnet = record.network === "eip155:84532";
  const configured = testnet ? env.BASE_SEPOLIA_RPC_URL : env.BASE_RPC_URL;
  let fallbacks; try { fallbacks = JSON.parse((testnet ? env.BASE_SEPOLIA_RPC_FALLBACKS : env.BASE_RPC_FALLBACKS) || "[]"); } catch { return null; }
  if (!Array.isArray(fallbacks)) return null;
  const endpoints = [...new Set([configured || (testnet ? "https://sepolia.base.org" : "https://mainnet.base.org"), ...fallbacks])].slice(0, 3);
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
