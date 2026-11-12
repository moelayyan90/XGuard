import { amount, need, exact } from './crypto.js';
export const AUTHORITY_PRICE = '50000';
export const FEE_SERVICE = Object.freeze({ id: 'authority-fee', route: 'authority', name: 'Completed financial authority receipt', amount: AUTHORITY_PRICE,
  description: 'One service fee for one completed, signed authority decision. Merchant principal and provider fees are separate. No repeat charge for retries, recovery or rejection.',
  example: { organization_id: 'customer_org_001', operation_id: 'customer_operation_001', invoice_token: 'OWNER_RECEIVED_INVOICE_TOKEN', max_amount_atomic: AUTHORITY_PRICE } });
export function validateFeeLimit(limit) {
  exact(limit, ['per_operation', 'per_period', 'lifetime', 'period_seconds']);
  need([3600, 86400].includes(limit.period_seconds) && amount(limit.per_operation) <= amount(limit.per_period) && amount(limit.per_period) <= amount(limit.lifetime), 'invalid_service_fee_budget');
}
export function feeAttenuates(child, parent) {
  if (!child) return true; // No fee permission is narrower than a funded limit.
  if (!parent) return false;
  return child.period_seconds === parent.period_seconds && ['per_operation', 'per_period', 'lifetime'].every(k => BigInt(child[k]) <= BigInt(parent[k]));
}
export function feeUsagePolicy(limit) { return { ...limit, currency: 'USDC', network: 'eip155:8453', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' }; }
