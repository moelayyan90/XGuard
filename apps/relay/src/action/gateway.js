import { boundedJson, digest, fail, proofStub } from '../compute/common.js';
import { actionCatalog, normalizeAction, actionPreflight, actionFingerprint } from './catalog.js';
import { actionCall, createPaypalOrder, capturePaypalOrder, reconcilePaypalOrder } from './state.js';
import { paypalConfig, verifyPaypalWebhook } from './paypal.js';
import { actionPage, ACTION_CSS, ACTION_BROWSER } from './site.js';

const allowedOrigins = ['https://xguardgate.com', 'https://api.xguardgate.com'];
const base = '/v1/checkout';
const orderPattern = /^xgo_[a-f0-9]{40}$/;
const token = request => request.headers.get('x-xguard-checkout-token') || '';
const tokenHash = async request => { if (!/^[A-Za-z0-9_-]{40,128}$/.test(token(request))) throw fail('checkout_recovery_token_required', 401); return digest(token(request)); };
function response(request, env, value, status = 200, contentType = 'application/json') {
  const origin = request.headers.get('origin');
  const headers = { 'content-type': contentType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-xguard-worker-version-id': env.CF_VERSION_METADATA?.id || '', 'x-xguard-worker-version-tag': env.CF_VERSION_METADATA?.tag || '' };
  if (origin && allowedOrigins.includes(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Idempotency-Key, X-XGuard-Checkout-Token' });
  return new Response(request.method === 'HEAD' ? null : typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
}
function assertOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.includes(origin)) throw fail('origin_not_allowed', 403);
}
export async function actionFetch(request, env) {
  const url = new URL(request.url), path = url.pathname;
  const publicPage = ['/', '/marketplace', '/checkout', '/dashboard', '/action/docs', '/action/how-it-works', '/action/pricing'].includes(path);
  if (!path.startsWith(base + '/') && path !== base && !publicPage && !['/.well-known/xguard-action-cloud.json', '/assets/action-v1.css', '/assets/action-v1.js', '/admin/action-cloud'].includes(path)) return null;
  try {
    if (!['xguardgate.com', 'api.xguardgate.com', 'localhost', '127.0.0.1'].includes(url.hostname)) return null;
    if (request.method === 'OPTIONS') { assertOrigin(request); return response(request, env, null, 204); }
    if (path === '/assets/action-v1.css' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, ACTION_CSS, 200, 'text/css; charset=utf-8');
    if (path === '/assets/action-v1.js' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, ACTION_BROWSER, 200, 'text/javascript; charset=utf-8');
    const config = paypalConfig(env);
    if (path === '/admin/action-cloud' && ['GET', 'HEAD'].includes(request.method)) {
      const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
      if (!key || key.length < 24 || request.headers.get('authorization') !== 'Bearer ' + key) throw fail('operator_authentication_required', 401);
      const id = url.searchParams.get('order_id');
      if (!id) return response(request, env, { card_ready: config.ready, blockers: config.blockers, account_revenue: 'UNKNOWN', instruction: 'Supply one known order_id for a bounded inspection. No global financial scan or account revenue inference.' });
      if (!orderPattern.test(id)) throw fail('invalid_order_id', 400);
      const { record } = await actionCall(env, id, 'inspect');
      const { input, token_hash, workflow, ...safe } = record;
      return response(request, env, { order: safe });
    }
    if (publicPage && ['GET', 'HEAD'].includes(request.method)) {
      // Preserve legacy JSON/Markdown discovery on the root for existing clients.
      if (path === '/' && /application\/json|text\/markdown/.test(request.headers.get('accept') || '')) return null;
      const html = actionPage(path, url.searchParams.get('service'), config);
      const r = response(request, env, html, 200, 'text/html; charset=utf-8');
      r.headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://www.paypal.com https://www.sandbox.paypal.com https://*.paypalobjects.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com; frame-src https://*.paypal.com https://*.paypalobjects.com; connect-src 'self' https://*.paypal.com https://*.paypalobjects.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://*.paypal.com");
      if (!['/checkout', '/dashboard'].includes(path)) r.headers.delete('x-robots-tag');
      return r;
    }
    if (path === base + '/catalog' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { name: 'XGuard Action Cloud', services: actionCatalog(), payment: { provider: 'paypal', ready: config.ready, environment: config.sandbox ? 'sandbox' : 'live', guest_card: 'Offered only when PayPal determines eligibility. No guarantee for every buyer.', blockers: config.blockers }, compute: { checkout: '/compute', card_ready: false, blocker: 'Requires separately funded and approved execution provider plus card adapter; no new charge accepted.' }, legacy_x402: '/api/paid/v1/catalog' });
    if (path === '/.well-known/xguard-action-cloud.json' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { name: 'XGuard Action Cloud', catalog: 'https://xguardgate.com' + base + '/catalog', checkout: 'https://xguardgate.com/marketplace', docs: 'https://xguardgate.com/action/docs', payment_methods: { paypal: config.ready, x402: 'preserved' }, operational_scope: 'bounded CSV processing and existing public read-only task adapters' });
    if (path === base + '/config' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { ready: config.ready, blockers: config.blockers, ...(config.ready ? { client_id: env.PAYPAL_CLIENT_ID, merchant_id: config.merchant_id, environment: config.sandbox ? 'sandbox' : 'live' } : {}), currency: 'USD' });
    if (path === base + '/proof-key' && ['GET', 'HEAD'].includes(request.method)) {
      const r = await proofStub(env).fetch('https://proofrail/public'); return response(request, env, await r.json(), r.status);
    }
    if (path === base + '/webhooks/paypal' && request.method === 'POST') {
      const event = await boundedJson(request, 65536);
      await verifyPaypalWebhook(env, request, event);
      const reference = event.resource?.disputed_transactions?.[0]?.seller_transaction_id || event.resource?.supplementary_data?.related_ids?.order_id || event.resource?.supplementary_data?.related_ids?.capture_id || event.resource?.id;
      if (!/^[A-Z0-9]{8,32}$/.test(reference || '')) return response(request, env, { accepted: true });
      const found = await actionCall(env, 'references', 'lookup', { reference });
      if (!found.id) return response(request, env, { accepted: true });
      const { record: q } = await actionCall(env, found.id, 'inspect');
      if (['PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED', 'CUSTOMER.DISPUTE.CREATED'].includes(event.event_type)) {
        await actionCall(env, q.id, 'update', { expected: ['AWAITING_PAYMENT', 'CAPTURING', 'PAID', 'EXECUTING', 'RUNNING', 'DELIVERY_PENDING', 'SUCCEEDED', 'REFUND_REQUIRED', 'REVIEW_REQUIRED', 'PAYMENT_UNKNOWN'], patch: { status: event.event_type === 'PAYMENT.CAPTURE.REFUNDED' ? 'REFUNDED' : 'REVERSED', error: 'provider_refund_reversal_or_dispute' } });
      } else if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') await reconcilePaypalOrder(env, q);
      return response(request, env, { accepted: true });
    }
    if (path === base + '/quote' && request.method === 'POST') {
      assertOrigin(request);
      const body = await boundedJson(request, 100000), { product, input } = normalizeAction(body.service, body.input);
      if (Object.keys(body).some(k => !['service', 'input'].includes(k))) throw fail('unsupported_checkout_field', 422);
      return response(request, env, { service: product.id, name: product.name, amount_cents: product.card_amount_cents, currency: 'USD', input_sha256: await actionFingerprint(product.id, input), card_ready: config.ready, blockers: config.blockers });
    }
    if (path === base + '/orders' && request.method === 'POST') {
      assertOrigin(request);
      const body = await boundedJson(request, 100000), { product, input } = normalizeAction(body.service, body.input);
      if (Object.keys(body).some(k => !['service', 'input'].includes(k))) throw fail('unsupported_checkout_field', 422);
      const key = request.headers.get('idempotency-key') || '';
      if (!/^[A-Za-z0-9_-]{16,100}$/.test(key)) throw fail('idempotency_key_required', 400);
      const token_hash = await tokenHash(request), id = 'xgo_' + (await digest({ token_hash, key })).slice(0, 40);
      const fingerprint = await actionFingerprint(product.id, input);
      // Recovery and retries remain available even if new purchasing is paused.
      try {
        const { record } = await actionCall(env, id, 'inspect');
        if (record.token_hash !== token_hash || record.fingerprint !== fingerprint) throw fail('idempotency_conflict', 409);
        return response(request, env, await actionCall(env, id, 'get', { token_hash }));
      } catch (e) { if (e.code !== 'order_not_found') throw e; }
      if (!config.ready) throw fail('card_payments_not_activated', 503, { blockers: config.blockers });
      await actionPreflight(env, product.id, input);
      const actor = await digest(new Date().toISOString().slice(0, 10) + ':' + (request.headers.get('cf-connecting-ip') || 'unattributed'));
      await actionCall(env, 'admission', 'admit', { actor });
      await actionCall(env, id, 'init', { token_hash, record: { id, service: product.id, name: product.name, input, fingerprint, amount_cents: product.card_amount_cents, environment: config.sandbox ? 'sandbox' : 'live' } });
      return response(request, env, await createPaypalOrder(env, id, token_hash));
    }
    const match = path.match(/^\/v1\/checkout\/orders\/(xgo_[a-f0-9]{40})(?:\/(capture))?$/);
    if (match && orderPattern.test(match[1])) {
      const token_hash = await tokenHash(request);
      if (!match[2] && ['GET', 'HEAD'].includes(request.method)) return response(request, env, await actionCall(env, match[1], 'get', { token_hash }));
      if (match[2] === 'capture' && request.method === 'POST') { assertOrigin(request); return response(request, env, await capturePaypalOrder(env, match[1], token_hash)); }
    }
    return response(request, env, { error: 'checkout_route_not_found' }, 404);
  } catch (error) { return response(request, env, { error: error.code || 'checkout_temporarily_unavailable', ...(error.details || {}) }, error.status || 503); }
}
