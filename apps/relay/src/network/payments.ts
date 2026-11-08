// Coverage is based on configured integrations. Never infer merchant approval
// from a person's possession of a bank account, card or Payoneer account.
export interface PaymentProvider {
  id: string;
  quote(input: { currency: string; amount_atomic: string; country?: string }): Promise<unknown>;
  reconcile(reference: string): Promise<unknown>;
}
export interface PayoutProvider {
  id: string;
  eligibility(recipientReference: string): Promise<{ eligible: boolean; evidence: string | null }>;
  reconcile(reference: string): Promise<unknown>;
}
export function paymentCoverage(env: Record<string, any>) {
  return { as_of: new Date().toISOString(), receiving: [{ id: 'x402-base-usdc', method: 'USDC', network: 'eip155:8453', currency: 'USDC', decimals: 6,
    configured: Boolean(env.XGUARD_TREASURY_USDC_ADDRESS && env.XGUARD_PAID_FACILITATOR), readiness: 'https://api.xguardgate.com/api/paid/v1/readiness',
    destination: env.XGUARD_TREASURY_USDC_ADDRESS || null, owner_control_verified: false, settlement_basis: 'Existing x402 engine; per-transaction evidence required.' }],
    unavailable: [
      { id: 'payoneer', state: 'OWNER_ACCOUNT_AND_PROGRAM_AUTHORIZATION_REQUIRED', automatic_checkout: false, reason: 'Business payment requests cannot be used as consumer-store checkout. No authorized API connection is configured.', source: 'https://payoneer.custhelp.com/app/answers/detail/a_id/12280' },
      { id: 'arab-bank-gateway', state: 'MERCHANT_APPROVAL_REQUIRED', reason: 'Requires merchant onboarding and an official integration credential.', source: 'https://www.arabbank.com.jo/mainmenu/home/SMEs_Banking/digitalization-and-innovation/payment-gateway' },
      { id: 'arab-bank-card-payout', state: 'ELIGIBILITY_UNVERIFIED', reason: 'No licensed push-to-card provider or eligible recipient token is configured.' },
      { id: 'arab-bank-iban', state: 'APPROVED_SETTLEMENT_RAIL_REQUIRED', reason: 'No authorized bank payout integration or tokenized recipient reference is configured.' },
    ], fx: { enabled: false, reason: 'No approved FX adapter connected; no rate is invented.' }, deferred_compute: { enabled: false, reason: 'Requires legal review, approved terms, risk limits and funded exposure.' },
    protection: { enabled: false, reason: 'No funded reserve or approved protection terms.' },
    owner_money: { available: null, pending: null, settled: null, currency: 'USDC', source: '/admin/paid-revenue', explanation: 'Balances require authenticated reconciliation; this public coverage endpoint does not establish revenue or a bank payout.' } };
}
