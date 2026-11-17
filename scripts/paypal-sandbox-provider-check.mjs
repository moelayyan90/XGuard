// Actual provider order creation in Sandbox only. Never approve or capture a
// payment here. A completed Sandbox purchase still requires the buyer UI.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
const origin = 'https://paypal-sandbox-xguard-mainnet.maqamapp.workers.dev';
const capability = randomBytes(32).toString('base64url');
const key = 'sandbox-activation-' + randomBytes(16).toString('hex');
const input = { service: 'csv-clean', input: { csv: 'item,name\nfixture, Sample \nfixture,Sample\n', key_columns: ['item'] } };
async function call(path, { body, secret = capability, extra = {} } = {}) {
  return fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'user-agent': 'XGuard-PayPal-Sandbox-activation-check/1.0', 'x-xguard-traffic-class': 'synthetic', 'x-xguard-checkout-token': secret, 'idempotency-key': key, origin, ...extra }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'error', signal: AbortSignal.timeout(45000) });
}
let catalog;
for (let attempt = 0; attempt < 6; attempt++) {
  const r = await call('/v1/checkout/catalog');
  if (r.ok) { catalog = await r.json(); break; }
  await r.body?.cancel();
  if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 3000));
}
assert.equal(catalog?.payment?.environment, 'sandbox', 'Require actual isolated Sandbox configuration');
assert.equal(catalog.payment.ready, true, 'Sandbox credentials must be configured');
const quoteResponse = await call('/v1/checkout/quote', { body: input });
assert.equal(quoteResponse.status, 200);
const quote = await quoteResponse.json();
assert.equal(quote.currency, 'USD'); assert.equal(quote.amount_cents, 200);
const createResponse = await call('/v1/checkout/orders', { body: input });
assert.equal(createResponse.status, 200, 'Actual Sandbox provider order creation failed');
const created = await createResponse.json(), order = created.order;
assert.equal(order?.environment, 'sandbox');
assert.equal(order.status, 'AWAITING_PAYMENT', 'Provider creation must be confirmed; recorded error: ' + (/^[a-z_]{1,80}$/.test(order.error || '') ? order.error : 'none'));
assert.match(order.paypal_order_id, /^[A-Z0-9]{8,32}$/);
assert.equal(order.amount_cents, quote.amount_cents); assert.equal(order.currency, 'USD');
assert.equal(order.receipt, null); assert.equal(created.result, undefined, 'No result before capture');
const repeatResponse = await call('/v1/checkout/orders', { body: input });
assert.equal(repeatResponse.status, 200);
const repeated = await repeatResponse.json();
assert.equal(repeated.order.id, order.id); assert.equal(repeated.order.paypal_order_id, order.paypal_order_id, 'Retry must reuse the provider order');
const recoveryResponse = await call('/v1/checkout/orders/' + order.id);
assert.equal(recoveryResponse.status, 200);
assert.equal((await recoveryResponse.json()).order.status, 'AWAITING_PAYMENT');
const denied = await call('/v1/checkout/orders/' + order.id, { secret: randomBytes(32).toString('base64url') });
assert.equal(denied.status, 404); await denied.body?.cancel();
for (const path of ['/supported', '/healthz', '/api/paid/v1/catalog']) {
  const r = await call(path); assert.equal(r.status, 404, 'Production service must be unavailable in Sandbox');
  assert.match(r.headers.get('x-robots-tag') || '', /noindex/); await r.body?.cancel();
}
const unsigned = await call('/v1/checkout/webhooks/paypal', { body: { id: 'SANDBOX-UNSIGNED-ACTIVATION-CHECK', event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: order.paypal_order_id } } });
assert.equal(unsigned.status, 401, 'Unsigned events must never authorize delivery'); await unsigned.body?.cancel();
console.log(JSON.stringify({ actual_paypal_sandbox_order: 'created', xguard_order_id: order.id, paypal_order_id: order.paypal_order_id, amount_cents: order.amount_cents, currency: order.currency, environment: 'sandbox', status: order.status, idempotent_retry: true, tenant_isolation: true, unsigned_webhook_rejected: true, production_services_isolated: true, buyer_approval: 'pending_browser_test', capture_attempts: 0, completed_payments: 0, real_payments: 0, revenue_verified: false }));
