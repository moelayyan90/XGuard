import { sha256 } from 'viem';
import { FEE_SERVICE } from './fees.js';
import { need, exact, amount, bytes, b64, unb64 } from './crypto.js';

const validId = x => typeof x === 'string' && /^[A-Za-z0-9_-]{8,80}$/.test(x);
const validOperation = x => typeof x === 'string' && /^[A-Za-z0-9_-]{8,100}$/.test(x);
async function tokenKey(env) {
  need(env.LIVE_ADMIN_KEY?.length >= 24, 'invoice_admission_unavailable', 503);
  return crypto.subtle.importKey('raw', bytes(env.LIVE_ADMIN_KEY), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);
}
const tokenContext = input => bytes(`xguard-afa-invoice/1:${input.organization_id}:${input.operation_id}`);
export function authorityFeeEnabled(env) {
  // No real invoice can be activated by changing an environment variable in
  // this release. The deployed Worker always has CF_VERSION_METADATA.
  return env.AFA_FEE_SIMULATION === 'on' && !env.CF_VERSION_METADATA && env.AFA_MODE !== 'live';
}
export async function invoiceCheckout(env, organizationId, operationId) {
  const input = { organization_id: organizationId, operation_id: operationId };
  return { endpoint: 'https://api.xguardgate.com/api/paid/v1/authority', method: 'POST',
    idempotency_key: 'invoice_' + sha256(bytes(organizationId + ':' + operationId)).slice(2),
    request: { ...input, invoice_token: b64(await crypto.subtle.sign('HMAC', await tokenKey(env), tokenContext(input))), max_amount_atomic: FEE_SERVICE.amount },
    availability: authorityFeeEnabled(env) ? 'isolated_simulation' : 'activation_review_required',
    instructions: 'The initial POST returns the exact x402 offer only in the approved execution environment. Preserve its quote, payload and Idempotency-Key. An uncertain response permits status/recovery only. This invoice is separate from merchant principal.' };
}
export function normalizeAuthorityFee(raw) {
  exact(raw, ['organization_id', 'operation_id', 'invoice_token', 'max_amount_atomic']);
  need(validId(raw.organization_id) && validOperation(raw.operation_id) && /^[A-Za-z0-9_-]{43}$/.test(raw.invoice_token || ''), 'invalid_authority_invoice');
  need(amount(raw.max_amount_atomic) >= BigInt(FEE_SERVICE.amount), 'buyer_budget_too_small');
  return { ...raw, capability: FEE_SERVICE.id };
}
export const authorityFeeSchema = { type: 'object', additionalProperties: false,
  required: ['organization_id', 'operation_id', 'invoice_token', 'max_amount_atomic'], properties: {
    organization_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,80}$' },
    operation_id: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,100}$' },
    invoice_token: { type: 'string', pattern: '^[A-Za-z0-9_-]{43}$', description: 'Private invoice capability issued by an authenticated checkout command. Never place it in a URL.' },
    max_amount_atomic: { type: 'string', pattern: '^[0-9]{1,30}$', description: 'Explicit service-fee spending cap in USDC atomic units; excludes merchant principal.' },
  } };
async function invoiceCall(env, input, body) {
  need(env.AUTHORITY, 'authority_storage_unavailable', 503);
  const stub = env.AUTHORITY.get(env.AUTHORITY.idFromName(`afa-v1:sandbox:${input.organization_id}`));
  const response = await stub.fetch('https://authority/afa/invoice', { method: 'POST', body: JSON.stringify({ ...body, organization_id: input.organization_id, operation_id: input.operation_id }) });
  const result = await response.json(); need(response.ok, result.error || 'invoice_state_unavailable', response.status);
  return result;
}
export async function authorityInvoicePreflight(env, input) {
  need(authorityFeeEnabled(env), 'authority_fee_activation_required', 503);
  need(await crypto.subtle.verify('HMAC', await tokenKey(env), unb64(input.invoice_token), tokenContext(input)), 'invalid_invoice_capability', 401);
  const result = await invoiceCall(env, input, { kind: 'describe' });
  need(result.mode === 'sandbox', 'live_authority_not_approved', 503);
  need(result.invoice.amount_atomic === FEE_SERVICE.amount && result.invoice.payee.toLowerCase() === String(env.XGUARD_TREASURY_USDC_ADDRESS).toLowerCase(), 'invoice_price_or_recipient_changed', 409);
  return result;
}
async function paymentRecord(env, fingerprint) {
  const stub = env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName(`payment:${fingerprint}`));
  const r = await stub.fetch('https://paid-gateway/operation/get', { method: 'POST', body: '{}' });
  need(r.ok, 'original_payment_status_unavailable', 503);
  return (await r.json()).record;
}
export async function claimAuthorityInvoice(env, input, payment) {
  const current = await authorityInvoicePreflight(env, input), prior = current.invoice.claim;
  let previousFailedNoEffect;
  if (prior && prior.authorization_fingerprint !== payment.authorization_fingerprint) {
    const record = await paymentRecord(env, prior.authorization_fingerprint);
    // A new customer-signed payment may replace only a definitely failed old
    // attempt. Missing/settling/ambiguous/credited/settled records never qualify.
    if (record?.status === 'failed' && ['verify', 'settle'].includes(record.failure_stage) && !record.observed_transaction && !record.transaction) previousFailedNoEffect = prior.authorization_fingerprint;
  }
  return invoiceCall(env, input, { ...payment, kind: 'claim', previous_failed_no_effect: previousFailedNoEffect });
}
export async function completeAuthorityInvoice(env, input, context) {
  need(authorityFeeEnabled(env) && context?.authority_payment, 'authority_payment_context_required', 503);
  const payment = context.authority_payment;
  const result = await invoiceCall(env, input, { ...payment, kind: 'complete' });
  const data = { service: FEE_SERVICE.id, organization_id: input.organization_id, operation_id: input.operation_id,
    invoice: result.invoice, authority_receipt: result.delivery_receipt, merchant_principal_is_separate: true,
    accounting_class: 'simulation_not_commercial_revenue', new_payment_required: false };
  return { data, status: 200, final_url: 'https://api.xguardgate.com/api/paid/v1/authority',
    body_sha256: sha256(bytes(JSON.stringify(data))).slice(2), body_bytes: bytes(JSON.stringify(data)).length, content_type: 'application/json',
    verification: { authority_decision_signed: true, service_fee_chain_verified: payment.chain_verified === true, merchant_settlement_finality_verified: false } };
}
