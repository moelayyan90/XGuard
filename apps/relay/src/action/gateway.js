import { boundedJson, digest, fail, proofStub } from '../compute/common.js';
import { actionCatalog, normalizeAction, actionPreflight, actionFingerprint } from './catalog.js';
import { actionCall, createPaypalOrder, capturePaypalOrder, reconcilePaypalOrder } from './state.js';
import { paypalApi, paypalConfig, paypalCredentialCheck, verifyPaypalWebhook } from './paypal.js';
import { actionPage, ACTION_CSS, ACTION_BROWSER } from './site.js';
import { productModule, commerceSaleEnabled } from '../products/registry.js';
import { storageQuotaCode } from '../live/util.ts';

const allowedOrigins = ['https://xguardgate.com', 'https://api.xguardgate.com'];
const base = '/v1/checkout';
const orderPattern = /^xgo_[a-f0-9]{40}$/;
const trackedEvents = new Set([
  'PAYMENT.CAPTURE.COMPLETED', 'PAYMENT.CAPTURE.PENDING', 'PAYMENT.CAPTURE.DENIED',
  'PAYMENT.CAPTURE.DECLINED', 'PAYMENT.CAPTURE.REFUNDED', 'PAYMENT.CAPTURE.REVERSED',
  'CHECKOUT.PAYMENT-APPROVAL.REVERSED', 'CUSTOMER.DISPUTE.CREATED',
  'CUSTOMER.DISPUTE.UPDATED', 'CUSTOMER.DISPUTE.RESOLVED', 'CHECKOUT.ORDER.VOIDED', 'CHECKOUT.ORDER.DECLINED',
]);
const token = request => request.headers.get('x-xguard-checkout-token') || '';
const tokenHash = async request => { if (!/^[A-Za-z0-9_-]{40,128}$/.test(token(request))) throw fail('checkout_recovery_token_required', 401); return digest(token(request)); };
function response(request, env, value, status = 200, contentType = 'application/json') {
  const origin = request.headers.get('origin');
  const headers = { 'content-type': contentType, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex', 'referrer-policy': 'no-referrer', 'strict-transport-security': 'max-age=31536000; includeSubDomains', 'x-xguard-worker-version-id': env.CF_VERSION_METADATA?.id || '', 'x-xguard-worker-version-tag': env.CF_VERSION_METADATA?.tag || '' };
  if (origin && allowedOrigins.includes(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type, Idempotency-Key, X-XGuard-Checkout-Token' });
  return new Response(request.method === 'HEAD' || [204, 205, 304].includes(status) ? null : typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
}
function assertOrigin(request) {
  const origin = request.headers.get('origin');
  if (origin && !allowedOrigins.includes(origin)) throw fail('origin_not_allowed', 403);
}
export async function checkoutReadiness(env, config = paypalConfig(env)) {
  if (!config.ready) return { ready: false, blockers: config.blockers };
  try {
    // This reserved reference cannot be issued by PayPal. The lookup reads the
    // same durable ledger used during order creation and never admits a buyer.
    const probe = await actionCall(env, 'references', 'lookup', { reference: '__checkout_readiness__' });
    if (probe.id !== null) throw new Error('Unexpected ledger response');
    return { ready: true, blockers: [] };
  } catch (error) {
    return { ready: false, blockers: [storageQuotaCode(error) || 'checkout_storage_unavailable'] };
  }
}
export async function actionFetch(request, env) {
  const url = new URL(request.url), path = url.pathname;
  const publicPage = ['/', '/marketplace', '/checkout', '/dashboard', '/action/docs', '/action/how-it-works', '/action/pricing'].includes(path);
  if (!path.startsWith(base + '/') && path !== base && !publicPage && !['/.well-known/xguard-action-cloud.json', '/assets/action-v1.css', '/assets/action-v1.js', '/admin/action-cloud', '/admin/action-cloud/paypal-readiness'].includes(path)) return null;
  try {
    if (!['xguardgate.com', 'api.xguardgate.com', 'localhost', '127.0.0.1'].includes(url.hostname)) return null;
    if (request.method === 'OPTIONS') { assertOrigin(request); return response(request, env, null, 204); }
    if (path === '/assets/action-v1.css' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, ACTION_CSS, 200, 'text/css; charset=utf-8');
    if (path === '/assets/action-v1.js' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, ACTION_BROWSER, 200, 'text/javascript; charset=utf-8');
    const config = paypalConfig(env);
    if (['/admin/action-cloud', '/admin/action-cloud/paypal-readiness'].includes(path) && ['GET', 'HEAD'].includes(request.method)) {
      const key = env.LIVE_ADMIN_KEY || env.XGUARD_OPERATOR_KEY;
      if (!key || key.length < 24 || request.headers.get('authorization') !== 'Bearer ' + key) throw fail('operator_authentication_required', 401);
      if (path.endsWith('/paypal-readiness')) return response(request, env, await paypalCredentialCheck(env));
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
      const nonce = crypto.randomUUID().replaceAll('-', '');
      const scriptNonce = ['/checkout', '/dashboard'].includes(path) ? '' : `'nonce-${nonce}' `;
      const html = actionPage(path, url.searchParams.get('service'), config, nonce);
      const r = response(request, env, html, 200, 'text/html; charset=utf-8');
      r.headers.set('content-security-policy', `default-src 'self'; script-src 'self' ${scriptNonce}https://www.paypal.com https://www.sandbox.paypal.com https://*.paypalobjects.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://*.paypal.com https://*.paypalobjects.com; frame-src https://*.paypal.com https://*.paypalobjects.com; connect-src 'self' https://*.paypal.com https://*.paypalobjects.com; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self' https://*.paypal.com`);
      if (!['/checkout', '/dashboard'].includes(path)) r.headers.delete('x-robots-tag');
      return r;
    }
    if (path === base + '/catalog' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { name: 'XGuard Action Cloud', services: actionCatalog(), payment: { provider: 'paypal', ready: config.ready, readiness_scope: 'merchant_configuration', readiness_url: base + '/readiness', environment: config.sandbox ? 'sandbox' : 'live', guest_card: 'Offered only when PayPal determines eligibility. No guarantee for every buyer.', blockers: config.blockers }, compute: { checkout: '/compute', card_ready: false, blocker: 'Requires separately funded and approved execution provider plus card adapter; no new charge accepted.' }, legacy_x402: '/api/paid/v1/catalog' });
    if (path === base + '/readiness' && ['GET', 'HEAD'].includes(request.method)) {
      const readiness = await checkoutReadiness(env, config);
      const result = response(request, env, { ...readiness, configured: config.ready, environment: config.sandbox ? 'sandbox' : 'live', scope: 'merchant_configuration_and_ledger_read' }, readiness.ready ? 200 : 503);
      if (!readiness.ready) result.headers.set('retry-after', '60');
      return result;
    }
    if (path === '/.well-known/xguard-action-cloud.json' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { name: 'XGuard Action Cloud', catalog: 'https://xguardgate.com' + base + '/catalog', checkout: 'https://xguardgate.com/marketplace', docs: 'https://xguardgate.com/action/docs', payment_methods: { paypal: config.ready, x402: 'preserved' }, operational_scope: 'bounded CSV processing and existing public read-only task adapters' });
    if (path === base + '/config' && ['GET', 'HEAD'].includes(request.method)) return response(request, env, { ready: config.ready, blockers: config.blockers, ...(config.ready ? { client_id: env.PAYPAL_CLIENT_ID, merchant_id: config.merchant_id, environment: config.sandbox ? 'sandbox' : 'live' } : {}), currency: 'USD' });
    if (path === base + '/proof-key' && ['GET', 'HEAD'].includes(request.method)) {
      const r = await proofStub(env).fetch('https://proofrail/public'); return response(request, env, await r.json(), r.status);
    }
    if (path === base + '/webhooks/paypal' && request.method === 'POST') {
      const event = await boundedJson(request, 65536);
      await verifyPaypalWebhook(env, request, event);
      if (!trackedEvents.has(event.event_type)) return response(request, env, { accepted: true });
      if (!/^[A-Za-z0-9-]{1,128}$/.test(event.id || '')) throw fail('paypal_event_id_invalid', 422);
      const notice = { id: event.id, type: event.event_type, fingerprint: await digest(event) };
      const related = event.resource?.supplementary_data?.related_ids;
      // Refunds may identify their capture through the official "up" link.
      // Parse its reference only; never fetch an event-supplied URL.
      let parentCapture;
      for (const link of Array.isArray(event.resource?.links) ? event.resource.links : []) if (link.rel === 'up' && typeof link.href === 'string') {
        try { const u = new URL(link.href); if (['api.paypal.com', 'api-m.paypal.com', 'api.sandbox.paypal.com', 'api-m.sandbox.paypal.com'].includes(u.hostname) && u.protocol === 'https:' && !u.username && !u.password && !u.port) parentCapture = /^\/v2\/payments\/captures\/([A-Z0-9]{8,32})$/.exec(u.pathname)?.[1]; } catch {}
      }
      const references = event.event_type.startsWith('CUSTOMER.DISPUTE.')
        ? [...new Set((event.resource?.disputed_transactions || []).map(item => item.seller_transaction_id))]
        : [related?.order_id || related?.capture_id || parentCapture || event.resource?.id];
      if (!references.length || references.some(ref => !/^[A-Z0-9]{8,32}$/.test(ref || ''))) throw fail('paypal_event_reference_invalid', 422);
      for (const reference of references) {
        const found = await actionCall(env, 'references', 'lookup', { reference });
        // A signed notification can arrive before a local mapping commits.
        // PayPal retries non-2xx deliveries. Never acknowledge an unrecorded financial event.
        if (!found.id) throw fail('paypal_reference_not_ready', 503);
        const { record: q, seen_event } = await actionCall(env, found.id, 'inspect', { event_id: event.id });
        if (seen_event) {
          if (seen_event.fingerprint !== notice.fingerprint) throw fail('paypal_event_conflict', 409);
          continue;
        }
        if (event.resource?.payee?.merchant_id && event.resource.payee.merchant_id !== config.merchant_id) throw fail('paypal_webhook_payee_mismatch', 409);
        if (!q.paypal_order_id) throw fail('paypal_reference_not_ready', 503);
        if (related?.order_id && related.order_id !== q.paypal_order_id) throw fail('paypal_webhook_order_mismatch', 409);
        if (related?.capture_id && parentCapture && related.capture_id !== parentCapture) throw fail('paypal_webhook_capture_mismatch', 409);
        const reportedCapture = related?.capture_id || parentCapture;
        if (q.capture && reportedCapture && q.capture.id !== reportedCapture) throw fail('paypal_webhook_capture_mismatch', 409);
        if (event.event_type === 'PAYMENT.CAPTURE.COMPLETED') {
          await reconcilePaypalOrder(env, q, undefined, notice);
          continue;
        }
        const update = { notice, expected: ['AWAITING_PAYMENT', 'CAPTURING', 'PAID', 'EXECUTING', 'RUNNING', 'DELIVERY_PENDING', 'SUCCEEDED', 'REFUND_REQUIRED', 'REVIEW_REQUIRED', 'PAYMENT_UNKNOWN'], patch: {} };
        if (event.event_type === 'PAYMENT.CAPTURE.REFUNDED') {
          if (!/^[A-Z0-9]{8,32}$/.test(event.resource?.id || '')) throw fail('paypal_refund_reference_invalid', 422);
          const refund = event.resource.status === 'COMPLETED' ? event.resource
            : await paypalApi(env, 'GET', '/v2/payments/refunds/' + event.resource.id);
          if (refund.id !== event.resource.id || refund.status !== 'COMPLETED') throw fail('paypal_refund_evidence_not_ready', 503);
          const amount = refund.amount;
          if (amount?.currency_code !== 'USD' || !/^(0|[1-9]\d{0,10})\.\d{2}$/.test(amount.value || '')) throw fail('paypal_refund_amount_invalid', 409);
          const cents = Number(amount.value.replace('.', ''));
          if (cents < 1 || cents > q.amount_cents) throw fail('paypal_refund_amount_invalid', 409);
          update.expected.push('EXPIRED');
          update.refund = { id: event.resource.id, cents };
          update.patch = { status: 'REVIEW_REQUIRED', error: 'provider_partial_refund_requires_reconciliation' };
        } else if (event.event_type === 'PAYMENT.CAPTURE.REVERSED') {
          update.expected.push('EXPIRED');
          update.patch = { status: 'REVERSED', error: 'provider_capture_reversed' };
        } else if (event.event_type.startsWith('CUSTOMER.DISPUTE.')) {
          const outcome = event.resource?.dispute_outcome?.outcome_code;
          if (/^[A-Z_]{1,64}$/.test(outcome || '')) update.notice = { ...notice, dispute_outcome: outcome };
          update.patch = { status: 'REVIEW_REQUIRED', error: event.event_type === 'CUSTOMER.DISPUTE.RESOLVED' ? 'provider_dispute_resolution_requires_reconciliation' : 'provider_dispute_open' };
        } else if (event.event_type === 'PAYMENT.CAPTURE.PENDING') {
          update.expected = ['AWAITING_PAYMENT', 'CAPTURING'];
          update.patch = { status: 'PAYMENT_UNKNOWN', error: 'capture_pending_final_confirmation' };
        } else {
          const cancelled = ['CHECKOUT.PAYMENT-APPROVAL.REVERSED', 'CHECKOUT.ORDER.VOIDED'].includes(event.event_type);
          update.expected = q.capture ? [] : ['AWAITING_PAYMENT', 'CAPTURING', 'PAYMENT_UNKNOWN', 'REVIEW_REQUIRED', 'EXPIRED'];
          update.patch = { status: 'REVIEW_REQUIRED', error: cancelled ? 'provider_approval_reversed' : 'provider_capture_denied' };
        }
        await actionCall(env, q.id, 'update', update);
      }
      return response(request, env, { accepted: true });
    }
    if (path === base + '/quote' && request.method === 'POST') {
      assertOrigin(request);
      const body = await boundedJson(request, 100000), { product, input } = normalizeAction(body.service, body.input);
      if (Object.keys(body).some(k => !['service', 'input'].includes(k))) throw fail('unsupported_checkout_field', 422);
      const readiness = await checkoutReadiness(env, config);
      return response(request, env, { service: product.id, name: product.name, amount_cents: product.card_amount_cents, currency: 'USD', input_sha256: await actionFingerprint(product.id, input), card_ready: readiness.ready, blockers: readiness.blockers });
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
      if (productModule(product.id) && !commerceSaleEnabled(env) && env.PAYPAL_ENVIRONMENT !== 'sandbox') throw fail('commerce_writer_activation_pending', 503);
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
  } catch (error) {
    const quota = storageQuotaCode(error);
    if (quota) {
      const result = response(request, env, { error: quota, quota_reset_at: new Date(new Date().setUTCHours(24, 0, 0, 0)).toISOString() }, 503);
      result.headers.set('retry-after', '300');
      return result;
    }
    return response(request, env, { error: error.code || 'checkout_temporarily_unavailable', ...(error.details || {}) }, error.status || 503);
  }
}
