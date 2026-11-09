import { BASE_NETWORK, BASE_USDC } from './policy.js';
export function settlementReceipt(record, receipt, confirmations) {
  return { success: true, transaction: record.hash, network: BASE_NETWORK, payer: record.authorization.from, asset: BASE_USDC, payTo: record.authorization.to, amount: record.authorization.value, blockNumber: String(receipt.blockNumber), blockHash: receipt.blockHash, confirmations, confirmedAt: new Date().toISOString(), rail: 'native-simulation', financial_value_moved: false };
}
