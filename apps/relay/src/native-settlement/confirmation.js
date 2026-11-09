import { getAddress, parseEventLogs, erc20Abi } from 'viem';
import { BASE_USDC, requireThat } from './policy.js';
import { settlementReceipt } from './receipt.js';
export class ConfirmationTracker {
  constructor(rpc, confirmations = 2) { requireThat(Number.isSafeInteger(confirmations) && confirmations >= 2, 'invalid_confirmation_policy'); this.rpc = rpc; this.required = confirmations; }
  async check(record) {
    requireThat(await this.rpc.getChainId() === 8453, 'rpc_chain_mismatch', 503);
    const receipt = await this.rpc.getTransactionReceipt(record.hash);
    if (!receipt) return { state: 'UNKNOWN', reason: 'settlement_pending' };
    requireThat(receipt.transactionHash.toLowerCase() === record.hash.toLowerCase(), 'receipt_hash_mismatch', 503);
    if (receipt.status !== 'success') return { state: 'REVERTED', reason: 'transaction_reverted' };
    const canonical = await this.rpc.getBlock(receipt.blockNumber);
    if (!canonical || canonical.hash !== receipt.blockHash) return { state: 'QUARANTINED', reason: 'noncanonical_receipt' };
    const logs = parseEventLogs({ abi: erc20Abi, eventName: 'Transfer', logs: receipt.logs || [], strict: true });
    const valid = getAddress(receipt.to) === BASE_USDC && logs.some(log => log.removed !== true && getAddress(log.address) === BASE_USDC && getAddress(log.args.from) === getAddress(record.authorization.from) && getAddress(log.args.to) === getAddress(record.authorization.to) && log.args.value === BigInt(record.authorization.value));
    if (!valid) return { state: 'QUARANTINED', reason: 'transfer_event_mismatch' };
    const head = await this.rpc.getBlockNumber(), confirmations = Number(head - BigInt(receipt.blockNumber) + 1n);
    if (confirmations < this.required) return { state: 'CONFIRMING', reason: 'settlement_pending', confirmations };
    requireThat(await this.rpc.readContract({ address: BASE_USDC, functionName: 'authorizationState', args: [record.authorization.from, record.authorization.nonce] }) === true, 'authorization_not_consumed', 503);
    return { state: 'CONFIRMED', receipt: settlementReceipt(record, receipt, confirmations) };
  }
}
