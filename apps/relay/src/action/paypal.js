import { boundedJson, fail } from '../compute/common.js';
import deployment from '../../deployment-state.json' with { type: 'json' };

export const PAYPAL_RECEIVER = 'moelayyan2026@gmail.com';
export function paypalConfig(env) {
  const sandbox = env.PAYPAL_ENVIRONMENT === 'sandbox';
  const blockers = [];
  for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID']) if (!env[k]) blockers.push(k.toLowerCase() + '_missing');
  if (env.PAYPAL_VERIFIED_EMAIL !== PAYPAL_RECEIVER) blockers.push('receiver_ownership_unverified');
  if (env.PAYPAL_ENABLED !== 'on') blockers.push('merchant_activation_pending');
  if (!sandbox && deployment.payment_state_write_version < 5) blockers.push('card_writer_activation_pending');
  if (!['live', 'sandbox'].includes(env.PAYPAL_ENVIRONMENT)) blockers.push('payment_environment_unverified');
  if (env.PAYPAL_MERCHANT_ID && !/^[A-Z0-9]{8,32}$/.test(env.PAYPAL_MERCHANT_ID)) blockers.push('merchant_identity_invalid');
  return { ready: blockers.length === 0, blockers, sandbox, origin: sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com', sdk: 'https://www.paypal.com/sdk/js', merchant_id: env.PAYPAL_MERCHANT_ID, receiver: PAYPAL_RECEIVER };
}
export async function paypalApi(env, method, path, body, requestId) {
  const config = paypalConfig(env);
  if (!config.ready) throw fail('card_payments_not_activated', 503, { blockers: config.blockers });
  if (!/^\/v[12]\/[a-z0-9/_-]+$/i.test(path)) throw fail('invalid_paypal_path', 503);
  const tokenResponse = await fetch(config.origin + '/v1/oauth2/token', { method: 'POST', headers: { authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (!tokenResponse.ok) throw fail('paypal_authentication_unavailable', 503);
  const token = await boundedJson(tokenResponse, 16384);
  if (typeof token.access_token !== 'string') throw fail('paypal_authentication_unavailable', 503);
  const response = await fetch(config.origin + path, { method, headers: { authorization: 'Bearer ' + token.access_token, 'content-type': 'application/json', prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const value = await boundedJson(response);
  if (!response.ok) throw fail('paypal_request_unconfirmed', 503);
  return value;
}
export function paypalOrderBody(q, env) {
  const config = paypalConfig(env);
  return { intent: 'CAPTURE', purchase_units: [{ reference_id: q.id, custom_id: q.id, invoice_id: q.id, description: q.name, payee: { email_address: config.receiver, merchant_id: config.merchant_id }, amount: { currency_code: 'USD', value: (q.amount_cents / 100).toFixed(2) } }], payment_source: { paypal: { experience_context: { brand_name: 'XGuard', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', landing_page: 'BILLING', return_url: 'https://xguardgate.com/dashboard', cancel_url: 'https://xguardgate.com/dashboard' } } } };
}
export function validatePaypalOrder(order, q, env, requireCapture = false) {
  const config = paypalConfig(env), units = order?.purchase_units;
  if (!/^[A-Z0-9]{8,32}$/.test(order?.id || '') || (q.paypal_order_id && order.id !== q.paypal_order_id) || order.intent !== 'CAPTURE' || !Array.isArray(units) || units.length !== 1) throw fail('paypal_order_mismatch', 409);
  const unit = units[0];
  if (unit.reference_id !== q.id || unit.custom_id !== q.id || unit.invoice_id !== q.id || unit.amount?.currency_code !== 'USD' || unit.amount?.value !== (q.amount_cents / 100).toFixed(2) || unit.payee?.merchant_id !== config.merchant_id || unit.payee?.email_address?.toLowerCase() !== config.receiver) throw fail('paypal_receiver_or_amount_mismatch', 409);
  if (!requireCapture) return null;
  const captures = unit.payments?.captures;
  if (order.status !== 'COMPLETED' || !Array.isArray(captures) || captures.length !== 1) return null;
  const c = captures[0];
  if (c.status !== 'COMPLETED' || c.final_capture !== true || c.amount?.currency_code !== 'USD' || c.amount?.value !== (q.amount_cents / 100).toFixed(2) || !/^[A-Z0-9]{8,32}$/.test(c.id || '')) return null;
  if (c.seller_receivable_breakdown?.gross_amount && (c.seller_receivable_breakdown.gross_amount.currency_code !== 'USD' || c.seller_receivable_breakdown.gross_amount.value !== c.amount.value)) throw fail('paypal_gross_mismatch', 409);
  return { id: c.id, status: c.status, amount: c.amount, seller_receivable_breakdown: c.seller_receivable_breakdown ?? null };
}
export async function verifyPaypalWebhook(env, request, event) {
  const config = paypalConfig(env), headerNames = ['paypal-auth-algo', 'paypal-cert-url', 'paypal-transmission-id', 'paypal-transmission-sig', 'paypal-transmission-time'];
  if (headerNames.some(k => !request.headers.get(k))) throw fail('invalid_webhook_signature', 401);
  const cert = new URL(request.headers.get('paypal-cert-url'));
  const allowed = config.sandbox ? ['api.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'] : ['api.paypal.com', 'api-m.paypal.com'];
  if (cert.protocol !== 'https:' || cert.username || cert.password || cert.port || !allowed.includes(cert.hostname) || !cert.pathname.startsWith('/v1/notifications/certs/')) throw fail('invalid_webhook_certificate', 401);
  const verified = await paypalApi(env, 'POST', '/v1/notifications/verify-webhook-signature', { auth_algo: request.headers.get('paypal-auth-algo'), cert_url: cert.href, transmission_id: request.headers.get('paypal-transmission-id'), transmission_sig: request.headers.get('paypal-transmission-sig'), transmission_time: request.headers.get('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event });
  if (verified.verification_status !== 'SUCCESS') throw fail('invalid_webhook_signature', 401);
}
