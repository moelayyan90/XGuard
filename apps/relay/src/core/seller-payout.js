import { privateKeyToAccount } from 'viem/accounts';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { HTTPFacilitatorClient } from '@x402/core/server';
import { SELLER_API, SELLER_ASSET, SELLER_NETWORK, sellerAddress, sellerInteger } from './seller-policy.js';
import { reconcilePayment } from './reconcile-payment.js';

// The platform never fabricates or provisions a treasury signing key. These
// functions only use the operator's explicitly configured treasury authority.
export function sellerPayoutConfiguration(env, destination, amount = '1') {
  try {
    const treasury = sellerAddress(env.XGUARD_TREASURY_USDC_ADDRESS);
    const payTo = sellerAddress(destination);
    const maximum = sellerInteger(env.XGUARD_PAYOUT_MAX_ATOMIC ?? '1000000', 'payout_maximum', 1);
    if (BigInt(amount) > BigInt(maximum)) return { ready: false, reason: 'payout_exceeds_configured_limit' };
    if (treasury === payTo) return { ready: true, mode: 'same_owner_retained', treasury };
    if (!/^0x[0-9a-fA-F]{64}$/.test(env.XGUARD_PAYOUT_PRIVATE_KEY || '')) return { ready: false, reason: 'payout_signer_not_configured' };
    const account = privateKeyToAccount(env.XGUARD_PAYOUT_PRIVATE_KEY);
    if (account.address.toLowerCase() !== treasury) return { ready: false, reason: 'payout_signer_does_not_control_treasury' };
    const facilitator = new URL(env.XGUARD_PAID_FACILITATOR);
    if (facilitator.protocol !== 'https:' || facilitator.username || facilitator.password) return { ready: false, reason: 'payout_facilitator_not_configured' };
    return { ready: true, mode: 'treasury_authorization', treasury };
  } catch { return { ready: false, reason: 'payout_configuration_invalid' }; }
}

export async function prepareSellerPayout(env, record) {
  const config = sellerPayoutConfiguration(env, record.payout_destination, record.seller_proceeds_atomic);
  if (!config.ready) throw new Error(config.reason);
  if (config.mode === 'same_owner_retained') return { mode: config.mode, treasury: config.treasury };
  const account = privateKeyToAccount(env.XGUARD_PAYOUT_PRIVATE_KEY);
  const requirements = { scheme: 'exact', network: SELLER_NETWORK, asset: SELLER_ASSET, amount: record.seller_proceeds_atomic, payTo: record.payout_destination, maxTimeoutSeconds: 300, extra: { name: 'USD Coin', version: '2' } };
  const payer = new x402Client().register(SELLER_NETWORK, new ExactEvmScheme(account));
  const payload = await payer.createPaymentPayload({ x402Version: 2, resource: { url: `${SELLER_API}/v1/sellers/payouts/${record.operation_hash}`, description: 'Settlement of a recorded seller receivable', mimeType: 'application/json' }, accepts: [requirements] });
  const auth = payload?.payload?.authorization;
  if (!auth || String(auth.from).toLowerCase() !== config.treasury || String(auth.to).toLowerCase() !== record.payout_destination.toLowerCase() || String(auth.value) !== record.seller_proceeds_atomic || !/^0x[0-9a-fA-F]{64}$/.test(auth.nonce)) throw new Error('payout_authorization_mismatch');
  return { mode: config.mode, treasury: config.treasury, payload, requirements, facilitator: env.XGUARD_PAID_FACILITATOR, nonce: auth.nonce };
}

export async function submitSellerPayout(prepared) {
  const client = new HTTPFacilitatorClient({ url: prepared.facilitator, timeoutMs: 10000 });
  const verified = await client.verify(prepared.payload, prepared.requirements);
  if (!verified.isValid || (verified.payer && verified.payer.toLowerCase() !== prepared.treasury)) return { definite_rejection: true, reason: 'payout_verification_rejected' };
  const result = await client.settle(prepared.payload, prepared.requirements);
  if (result.success === false) return { definite_rejection: true, reason: 'payout_settlement_rejected' };
  // A positive facilitator response is followed by exact chain evidence before
  // the ledger calls a seller payout confirmed. Unknown delivery is never resent.
  return { observed_transaction: /^0x[0-9a-fA-F]{64}$/.test(result.transaction || '') ? result.transaction : null };
}

export async function confirmSellerPayout(env, payout) {
  const p = payout.prepared;
  if (!p || p.mode !== 'treasury_authorization') return null;
  return reconcilePayment(env, { network: SELLER_NETWORK, asset: SELLER_ASSET, payer: p.treasury, pay_to: payout.payout_destination, nonce: p.nonce, amount: payout.seller_proceeds_atomic, observed_transaction: payout.observed_transaction });
}
