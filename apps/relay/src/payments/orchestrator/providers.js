import { paypalConfig } from '../../action/paypal.js';

export function paymentProviders(env) {
  const paypal = paypalConfig(env);
  return { providers: [
    { id: 'paypal', methods: ['PayPal', 'eligible guest credit/debit cards'], configured: paypal.ready, readiness: '/v1/checkout/readiness', environment: paypal.sandbox ? 'sandbox' : 'live', destination: 'Verified merchant account for moelayyan2026@gmail.com', blockers: paypal.blockers, checkout: '/checkout', advanced_card_fields_activated: false, eligibility: 'Card funding is rendered only when the PayPal SDK determines eligibility.' },
    { id: 'x402-base-usdc', methods: ['USDC on Base via x402'], configured: Boolean(env.XGUARD_TREASURY_USDC_ADDRESS && (env.XGUARD_PAID_FACILITATOR || env.X402_BASE_PRIMARY)), readiness: '/api/paid/v1/readiness', checkout: '/api/paid/v1/catalog', destination: env.XGUARD_TREASURY_USDC_ADDRESS || null, okx_destination_verified: false, direct_transaction_hash_payments_activated: false },
  ], additional_methods: ['Apple Pay', 'Google Pay', 'bank transfers', 'local payments', 'Payoneer payouts', 'WalletConnect direct transfers'].map(method => ({ method, status: 'Awaiting Provider Approval', active: false })), scope: 'Configuration is not a settled payment. Inspect the specific provider readiness. No currency conversion, OKX payout or unsupported funding method is claimed.' };
}
