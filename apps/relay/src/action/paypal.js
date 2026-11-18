import { boundedJson, fail } from '../compute/common.js';
import deployment from '../../deployment-state.json' with { type: 'json' };

export const PAYPAL_RECEIVER = 'moelayyan2026@gmail.com';
export const PAYPAL_CHECKOUT_PREVIEW_ORIGIN = 'https://paypal-sandbox-xguard-mainnet.maqamapp.workers.dev';
export function paypalConfig(env) {
  const sandbox = env.PAYPAL_ENVIRONMENT === 'sandbox';
  // A real Sandbox merchant has its own test email. Never allow this override
  // to redirect live receipts away from the owner's requested account.
  const receiver = sandbox ? env.PAYPAL_SANDBOX_RECEIVER_EMAIL || PAYPAL_RECEIVER : PAYPAL_RECEIVER;
  const blockers = [];
  for (const k of ['PAYPAL_CLIENT_ID', 'PAYPAL_CLIENT_SECRET', 'PAYPAL_MERCHANT_ID', 'PAYPAL_WEBHOOK_ID']) if (!env[k]) blockers.push(k.toLowerCase() + '_missing');
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(receiver) || receiver.length > 254 || env.PAYPAL_VERIFIED_EMAIL !== receiver) blockers.push('receiver_ownership_unverified');
  if (env.PAYPAL_ENABLED !== 'on') blockers.push('merchant_activation_pending');
  if (!sandbox && deployment.payment_state_write_version < 5) blockers.push('card_writer_activation_pending');
  if (!['live', 'sandbox'].includes(env.PAYPAL_ENVIRONMENT)) blockers.push('payment_environment_unverified');
  if (env.PAYPAL_MERCHANT_ID && !/^[A-Z0-9]{8,32}$/.test(env.PAYPAL_MERCHANT_ID)) blockers.push('merchant_identity_invalid');
  return { ready: blockers.length === 0, blockers, sandbox, origin: sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com', sdk: 'https://www.paypal.com/sdk/js', merchant_id: env.PAYPAL_MERCHANT_ID, receiver };
}
async function paypalAccessToken(env, config) {
  const tokenResponse = await fetch(config.origin + '/v1/oauth2/token', { method: 'POST', headers: { authorization: 'Basic ' + btoa(env.PAYPAL_CLIENT_ID + ':' + env.PAYPAL_CLIENT_SECRET), accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' }, body: 'grant_type=client_credentials', redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (!tokenResponse.ok) {
    let failure;
    try { failure = await boundedJson(tokenResponse, 16384); } catch {}
    // OAuth's fixed error names identify the remediation without disclosing a
    // provider description, client ID, secret or response body to recovery UI.
    const codes = { invalid_client: 'paypal_oauth_invalid_client', invalid_request: 'paypal_oauth_invalid_request', invalid_scope: 'paypal_oauth_invalid_scope', unsupported_grant_type: 'paypal_oauth_unsupported_grant', access_denied: 'paypal_oauth_access_denied' };
    const statuses = { 400: 'paypal_oauth_bad_request', 401: 'paypal_oauth_unauthorized', 403: 'paypal_oauth_forbidden', 404: 'paypal_oauth_not_found', 429: 'paypal_oauth_rate_limited' };
    throw fail(Object.hasOwn(codes, failure?.error) ? codes[failure.error] : statuses[tokenResponse.status] || 'paypal_authentication_unavailable', 503);
  }
  const token = await boundedJson(tokenResponse, 16384);
  if (typeof token.access_token !== 'string') throw fail('paypal_oauth_token_missing', 503);
  return token.access_token;
}
export async function paypalCredentialCheck(env) {
  const config = paypalConfig(env), blockers = config.blockers.filter(code => !['merchant_activation_pending', 'card_writer_activation_pending'].includes(code));
  if (blockers.length) throw fail('paypal_credentials_not_configured', 503, { blockers });
  // Operator-only authentication check: no order, approval, capture or payout.
  // The short-lived access token is discarded and never returned or logged.
  await paypalAccessToken(env, config);
  return { environment: config.sandbox ? 'sandbox' : 'live', credentials_valid: true, checkout_enabled: config.ready, checkout_blockers: config.blockers, merchant_eligibility_verified_by_this_check: false, transactions_submitted: 0 };
}
export async function paypalApi(env, method, path, body, requestId) {
  const config = paypalConfig(env);
  // Existing captures and signed refund/dispute notices still need to reconcile during a sales pause.
  const recoveryRead = (method === 'GET' && /^\/v2\/checkout\/orders\/[A-Z0-9]{8,32}$/.test(path)) ||
    (method === 'POST' && path === '/v1/notifications/verify-webhook-signature');
  const blockers = recoveryRead ? config.blockers.filter(code => !['merchant_activation_pending', 'card_writer_activation_pending'].includes(code)) : config.blockers;
  if (blockers.length) throw fail('card_payments_not_activated', 503, { blockers });
  if (!/^\/v[12]\/[a-z0-9/_-]+$/i.test(path)) throw fail('invalid_paypal_path', 503);
  const token = await paypalAccessToken(env, config);
  const response = await fetch(config.origin + path, { method, headers: { authorization: 'Bearer ' + token, accept: 'application/json', 'content-type': 'application/json', prefer: 'return=representation', ...(requestId ? { 'PayPal-Request-Id': requestId } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), redirect: 'manual', signal: AbortSignal.timeout(20000) });
  const value = await boundedJson(response);
  if (!response.ok) throw fail('paypal_request_unconfirmed', 503);
  return value;
}
export function paypalOrderBody(q, env) {
  const config = paypalConfig(env);
  const origin = config.sandbox && env.XGUARD_CHECKOUT_SANDBOX_PREVIEW === 'on' ? PAYPAL_CHECKOUT_PREVIEW_ORIGIN : 'https://xguardgate.com';
  return { intent: 'CAPTURE', purchase_units: [{ reference_id: q.id, custom_id: q.id, invoice_id: q.id, description: q.name, payee: { email_address: config.receiver, merchant_id: config.merchant_id }, amount: { currency_code: 'USD', value: (q.amount_cents / 100).toFixed(2) } }], payment_source: { paypal: { experience_context: { brand_name: 'XGuard', shipping_preference: 'NO_SHIPPING', user_action: 'PAY_NOW', landing_page: 'BILLING', return_url: origin + '/dashboard?paypal=return', cancel_url: origin + '/dashboard?paypal=cancel' } } } };
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
  let cert;
  try { cert = new URL(request.headers.get('paypal-cert-url')); } catch { throw fail('invalid_webhook_certificate', 401); }
  const allowed = config.sandbox ? ['api.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'] : ['api.paypal.com', 'api-m.paypal.com'];
  if (cert.protocol !== 'https:' || cert.username || cert.password || cert.port || !allowed.includes(cert.hostname) || !cert.pathname.startsWith('/v1/notifications/certs/')) throw fail('invalid_webhook_certificate', 401);
  const verified = await paypalApi(env, 'POST', '/v1/notifications/verify-webhook-signature', { auth_algo: request.headers.get('paypal-auth-algo'), cert_url: cert.href, transmission_id: request.headers.get('paypal-transmission-id'), transmission_sig: request.headers.get('paypal-transmission-sig'), transmission_time: request.headers.get('paypal-transmission-time'), webhook_id: env.PAYPAL_WEBHOOK_ID, webhook_event: event });
  if (verified.verification_status !== 'SUCCESS') throw fail('invalid_webhook_signature', 401);
}
