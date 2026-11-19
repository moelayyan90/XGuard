import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { PRODUCT_SERVICES } from '../src/products/registry.js';
import { financePage, financialRow } from '../src/action/finance.js';

const root = fileURLToPath(new URL('../src/live-entry.js', import.meta.url));
const paid = fileURLToPath(new URL('../src/paid-agent-entry.js', import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'xguard-action-'));
const built = await build({ stdin: { resolveDir: dirname(root), contents: `
import app from ${JSON.stringify(root)};
import { refreshOwnerReportCheck } from ${JSON.stringify(fileURLToPath(new URL('../src/live/owner-report-check.ts', import.meta.url)))};
export { LiveControl } from ${JSON.stringify(fileURLToPath(new URL('../src/live/objects.ts', import.meta.url)))};
import { PaidGatewayState } from ${JSON.stringify(paid)};
export { ProofAuthority } from ${JSON.stringify(paid)};
export class TestGateway extends PaidGatewayState {
  async fetch(request) {
    const path = new URL(request.url).pathname;
    if(path === '/fixture/alarm') { await this.alarm(); return new Response('ok'); }
    if(path === '/fixture/age-order') {
      const order = await this.state.storage.get('action:v1');
      order.created_at = new Date(Date.now() - 31 * 60000).toISOString();
      await this.state.storage.put('action:v1', order); return new Response('ok');
    }
    if(path === '/fixture/fail-next-update') { await this.state.storage.put('fixture:fail', true); return new Response('ok'); }
    if(path === '/action/update' && await this.state.storage.get('fixture:fail')) { await this.state.storage.delete('fixture:fail'); return Response.json({error:'simulated_quota_exhaustion'},{status:503}); }
    return super.fetch(request);
  }
}
export default { ...app, async fetch(req, env, ctx) {
  if (new URL(req.url).pathname === '/fixture/check-owner-report') {
    const settings = new URL(req.url).searchParams.has('missing-owner') ? { ...env, LIVE_ADMIN_KEY: undefined } : env;
    await refreshOwnerReportCheck(settings, (r, e) => app.fetch(r, e, ctx));
    return new Response('done');
  }
  return app.fetch(req, env, ctx);
} };
` }, bundle: true, write: false, format: 'esm', platform: 'node', external: ['node:*', 'cloudflare:*'], target: 'es2023' });
const bundle = join(dir, 'worker.mjs'); await writeFile(bundle, built.outputFiles[0].text);
let count = { create: 0, capture: 0, get: 0, verify: 0 }, captureMode = 'ok'; const orders = new Map(), refunds = new Map();
const fixtureOwner = 'owner-finance-fixture-only-0123456789';
const worker = { name: 'action-test', modules: true, modulesRoot: dir, scriptPath: bundle, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LIVE_CONTROL: { className: 'LiveControl', useSQLite: true }, PAID_GATEWAY: { className: 'TestGateway', useSQLite: true }, PROOF_AUTHORITY: { className: 'ProofAuthority', useSQLite: true } },
  bindings: { LIVE_ADMIN_KEY: fixtureOwner, PAYPAL_ENVIRONMENT: 'sandbox', PAYPAL_ENABLED: 'on', PAYPAL_CLIENT_ID: 'synthetic-client', PAYPAL_CLIENT_SECRET: 'synthetic-secret', PAYPAL_MERCHANT_ID: 'TESTMERCHANT1', PAYPAL_VERIFIED_EMAIL: 'moelayyan2026@gmail.com', PAYPAL_WEBHOOK_ID: 'synthetic-webhook' },
  outboundService: async request => {
    const u = new URL(request.url);
    assert.equal(u.hostname, 'api-m.sandbox.paypal.com', 'No real financial or provider network calls permitted');
    if (u.pathname === '/v1/oauth2/token') return MFResponse.json({ access_token: 'synthetic-token' });
    if (u.pathname === '/v1/notifications/verify-webhook-signature') { count.verify++; const b = await request.json(); return MFResponse.json({ verification_status: b.transmission_sig === 'synthetic-valid' ? 'SUCCESS' : 'FAILURE' }); }
    if (u.pathname === '/v2/checkout/orders' && request.method === 'POST') {
      count.create++; const b = await request.json();
      assert.equal(b.purchase_units[0].payee.email_address, 'moelayyan2026@gmail.com');
      const id = 'TESTORDER' + String(count.create).padStart(5, '0');
      const order = { id, intent: b.intent, status: 'CREATED', purchase_units: b.purchase_units };
      orders.set(id, order); return MFResponse.json(order);
    }
    if (request.method === 'GET' && u.pathname.startsWith('/v2/payments/refunds/')) {
      const refund = refunds.get(u.pathname.split('/').pop()); assert.ok(refund); return MFResponse.json(refund);
    }
    const m = u.pathname.match(/^\/v2\/checkout\/orders\/([A-Z0-9]+)(\/capture)?$/); assert.ok(m);
    const order = orders.get(m[1]); assert.ok(order);
    if (m[2]) {
      count.capture++; assert.equal(request.headers.get('paypal-request-id'), order.purchase_units[0].custom_id + '-capture');
      order.status = 'COMPLETED';
      const amount = { currency_code: 'USD', value: captureMode === 'wrong-amount' ? '0.01' : '2.00' };
      order.purchase_units[0].payments = { captures: [{ id: 'TESTCAPTURE' + String(count.capture).padStart(5, '0'), status: 'COMPLETED', amount, final_capture: true, seller_receivable_breakdown: { gross_amount: amount, paypal_fee: { currency_code: 'USD', value: '0.40' }, net_amount: { currency_code: 'USD', value: '1.60' } } }] };
      if (captureMode === 'timeout') throw new Error('Simulated lost capture response after provider committed');
    } else count.get++;
    return MFResponse.json(order);
  },
};
worker.bindings.CF_VERSION_METADATA = { id: 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee', tag: 'git-fixture' };
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [worker] }));
const token = 'a'.repeat(64), otherToken = 'b'.repeat(64);
const input = { service: 'csv-clean', input: { csv: 'email,name\na@example.com, Alice \na@example.com,Alice\n', key_columns: ['email'] } };
const dispatch = (path, { body, key = 'synthetic-unique-idempotency-key', capability = token, headers = {} } = {}) => mf.dispatchFetch('https://xguardgate.com' + path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'idempotency-key': key, 'x-xguard-checkout-token': capability, 'cf-connecting-ip': '198.51.100.1', ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
const ns = await mf.getDurableObjectNamespace('PAID_GATEWAY');
const stub = id => ns.get(ns.idFromName('action-cloud-v1:' + id));
const alarm = id => stub(id).fetch('https://fixture/fixture/alarm');
async function create(key) { const r = await dispatch('/v1/checkout/orders', { body: input, key }); assert.equal(r.status, 200); return (await r.json()).order; }
try {
  const results = await Promise.all([create('first-synthetic-order'), create('first-synthetic-order')]);
  const q = results.find(x => x.paypal_order_id); assert.ok(q, JSON.stringify({ results, count })); assert.equal(count.create, 1);
  assert.equal((await dispatch('/v1/checkout/orders/' + q.id, { capability: otherToken })).status, 404);
  assert.equal((await dispatch('/v1/checkout/orders/' + q.id + '/capture', { capability: otherToken, body: {} })).status, 404);
  await alarm(q.id); assert.equal((await (await dispatch('/v1/checkout/orders/' + q.id)).json()).order.status, 'AWAITING_PAYMENT');
  const unapproved = await dispatch('/v1/checkout/orders/' + q.id + '/capture', { body: {} });
  assert.equal((await unapproved.json()).order.status, 'AWAITING_PAYMENT');
  assert.equal(count.capture, 0, 'Browser return data alone cannot authorize a capture');
  orders.get(q.paypal_order_id).status = 'APPROVED';
  await Promise.all([dispatch('/v1/checkout/orders/' + q.id + '/capture', { body: {} }), dispatch('/v1/checkout/orders/' + q.id + '/capture', { body: {} })]);
  assert.equal(count.capture, 1); await alarm(q.id);
  const delivered = await (await dispatch('/v1/checkout/orders/' + q.id)).json();
  assert.equal(delivered.order.status, 'SUCCEEDED'); assert.equal(delivered.result.report.output_rows, 1); assert.equal(delivered.result.report.duplicate_rows, 1);
  assert.equal(delivered.order.receipt.payload.environment, 'sandbox'); assert.equal(delivered.order.receipt.payload.accounting.net_profit, null);
  const key = await (await dispatch('/v1/checkout/proof-key')).json();
  const parts = delivered.order.receipt.proof.split('.'), decode = s => Uint8Array.from(Buffer.from(s, 'base64url'));
  assert.deepEqual(JSON.parse(Buffer.from(parts[1], 'base64url').toString()), delivered.order.receipt.payload);
  const jwk = key.jwk || key; const cryptoKey = await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, decode(parts[2]), new TextEncoder().encode(parts.slice(0, 2).join('.'))), true);
  await alarm(q.id); assert.equal(count.capture, 1);
  assert.equal((await dispatch('/v1/checkout/orders', { body: { ...input, input: { csv: 'h\nchanged' } }, key: 'first-synthetic-order' })).status, 409);
  captureMode = 'timeout'; const interrupted = await create('lost-capture-response-order');
  orders.get(interrupted.paypal_order_id).status = 'APPROVED';
  await dispatch('/v1/checkout/orders/' + interrupted.id + '/capture', { body: {} });
  const before = count.capture; await alarm(interrupted.id); await alarm(interrupted.id);
  assert.equal(count.capture, before, 'Read-only reconciliation must never submit another capture');
  assert.equal((await (await dispatch('/v1/checkout/orders/' + interrupted.id)).json()).order.status, 'SUCCEEDED');
  captureMode = 'ok'; const quota = await create('storage-fails-after-capture-order');
  orders.get(quota.paypal_order_id).status = 'APPROVED';
  await stub(quota.id).fetch('https://fixture/fixture/fail-next-update');
  await dispatch('/v1/checkout/orders/' + quota.id + '/capture', { body: {} });
  const captured = count.capture; await alarm(quota.id); await alarm(quota.id); assert.equal(count.capture, captured);
  assert.equal((await (await dispatch('/v1/checkout/orders/' + quota.id)).json()).order.status, 'SUCCEEDED');
  // Exercise every new service through real SQLite order/capture/delivery state.
  // Different fixture actors avoid conflating per-actor admission with execution.
  for (const [index, service] of PRODUCT_SERVICES.entries()) {
    const created = await dispatch('/v1/checkout/orders', { body: { service: service.id, input: Object.fromEntries(Object.entries(service.example).filter(([key]) => key !== 'max_amount_atomic')) }, key: 'commercial-fixture-order-' + index, headers: { 'cf-connecting-ip': '198.51.100.' + (20 + index) } });
    assert.equal(created.status, 200, await created.clone().text());
    const task = (await created.json()).order;
    orders.get(task.paypal_order_id).status = 'APPROVED';
    await dispatch('/v1/checkout/orders/' + task.id + '/capture', { body: {} }); await alarm(task.id);
    const deliveredTask = await (await dispatch('/v1/checkout/orders/' + task.id)).json();
    assert.equal(deliveredTask.order.status, 'SUCCEEDED', service.id + ': ' + JSON.stringify(deliveredTask.order));
    assert.equal(deliveredTask.result.data.service, service.id); assert.equal(deliveredTask.order.receipt.payload.environment, 'sandbox');
    assert.equal(deliveredTask.order.receipt.payload.result_sha256.length, 64);
  }
  captureMode = 'wrong-amount'; const mismatch = await create('mismatched-capture-amount-order');
  orders.get(mismatch.paypal_order_id).status = 'APPROVED';
  await dispatch('/v1/checkout/orders/' + mismatch.id + '/capture', { body: {} }); await alarm(mismatch.id);
  assert.notEqual((await (await dispatch('/v1/checkout/orders/' + mismatch.id)).json()).order.status, 'SUCCEEDED');
  const unsigned = await dispatch('/v1/checkout/webhooks/paypal', { body: { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: q.paypal_order_id } } }); assert.equal(unsigned.status, 401);
  const bad = await dispatch('/v1/checkout/webhooks/paypal', { body: { event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: q.paypal_order_id } }, headers: { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-fixture', 'paypal-transmission-id': 'fixture', 'paypal-transmission-time': new Date().toISOString(), 'paypal-transmission-sig': 'bad' } }); assert.equal(bad.status, 401);
  const webhookHeaders = { 'paypal-auth-algo': 'SHA256withRSA', 'paypal-cert-url': 'https://api-m.sandbox.paypal.com/v1/notifications/certs/CERT-fixture', 'paypal-transmission-id': 'fixture', 'paypal-transmission-time': new Date().toISOString(), 'paypal-transmission-sig': 'synthetic-valid' };
  const webhook = event => dispatch('/v1/checkout/webhooks/paypal', { body: { id: 'WH-' + crypto.randomUUID(), ...event }, headers: webhookHeaders });
  const oldVoid = { event_type:'CHECKOUT.ORDER.VOIDED', resource:{ id:q.paypal_order_id } };
  assert.equal((await webhook(oldVoid)).status, 200);
  assert.equal((await (await dispatch('/v1/checkout/orders/' + q.id)).json()).order.status, 'SUCCEEDED');
  const inspectEvent = async (id, event_id) => (await stub(id).fetch('https://action.internal/action/inspect', { method: 'POST', headers:{'content-type':'application/json'}, body:JSON.stringify({ event_id }) })).json();
  const orphan = await webhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource:{ id:'UNMAPPED123456' } });
  assert.equal(orphan.status, 503, 'A provider retry is required until the durable mapping exists');
  const late = await create('expired-before-capture-notice');
  await stub(late.id).fetch('https://fixture/fixture/age-order'); await alarm(late.id);
  assert.equal((await inspectEvent(late.id)).record.status, 'EXPIRED');
  const providerLate = orders.get(late.paypal_order_id);
  const lateCapture = { id:'TESTLATECAPTURE001', status:'COMPLETED', amount:providerLate.purchase_units[0].amount, final_capture:true };
  const lateNotice = { id:'WH-LATE001', event_type:'PAYMENT.CAPTURE.COMPLETED', resource:{id:lateCapture.id, supplementary_data:{related_ids:{order_id:late.paypal_order_id}}} };
  assert.equal((await webhook(lateNotice)).status, 503, 'Await independent capture evidence');
  providerLate.status = 'COMPLETED'; providerLate.purchase_units[0].payments = { captures:[lateCapture] };
  assert.equal((await webhook(lateNotice)).status, 200);
  const lateResult = await (await dispatch('/v1/checkout/orders/' + late.id)).json();
  assert.equal(lateResult.order.status, 'REFUND_REQUIRED'); assert.equal(lateResult.result, undefined);
  assert.deepEqual([lateResult.order.liability.capture_id, lateResult.order.liability.amount_cents], [lateCapture.id,200]);
  const partial = { id: 'WH-PARTIAL1', event_type: 'PAYMENT.CAPTURE.REFUNDED', resource: { id: 'TESTREFUND001', status: 'COMPLETED', amount: { currency_code: 'USD', value: '1.00' }, links: [{ rel: 'up', href: 'https://api-m.sandbox.paypal.com/v2/payments/captures/' + delivered.order.receipt.payload.paypal_capture_id }] } };
  assert.equal((await webhook(partial)).status, 200);
  const held = await (await dispatch('/v1/checkout/orders/' + q.id)).json(); assert.equal(held.order.status, 'REVIEW_REQUIRED'); assert.equal(held.result, undefined);
  await webhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: q.paypal_order_id } });
  assert.equal((await (await dispatch('/v1/checkout/orders/' + q.id)).json()).order.status, 'REVIEW_REQUIRED', 'Delayed completion cannot release a partial refund hold');
  const duplicates = await Promise.all([webhook(partial), webhook({ ...partial, id: 'WH-DELIVERY2' })]);
  assert.ok(duplicates.every(r => r.status === 200));
  assert.equal((await inspectEvent(q.id, partial.id)).record.confirmed_refund_cents, 100, 'Duplicate notices cannot count a refund twice');
  const conflicting = await webhook({ ...partial, resource: { ...partial.resource, amount: { currency_code: 'USD', value: '2.00' } } });
  assert.equal(conflicting.status, 409);
  const remaining = { ...partial, id:'WH-PARTIAL2', resource:{ ...partial.resource, id:'TESTREFUND002' } };
  const pending = { ...remaining, resource:{...remaining.resource, status:'PENDING'} };
  refunds.set(pending.resource.id, pending.resource);
  assert.equal((await webhook(pending)).status, 503);
  assert.equal((await inspectEvent(q.id, remaining.id)).record.confirmed_refund_cents, 100);
  refunds.set(pending.resource.id, remaining.resource);
  assert.equal((await webhook(pending)).status, 200);
  assert.equal((await inspectEvent(q.id, remaining.id)).record.confirmed_refund_cents, 200);
  const dispute = { id:'WH-DISPUTE1', event_type:'CUSTOMER.DISPUTE.CREATED', resource:{disputed_transactions:[{seller_transaction_id:quota.paypal_order_id}]} };
  await webhook(dispute);
  assert.equal((await inspectEvent(quota.id, dispute.id)).record.status, 'REVIEW_REQUIRED');
  const resolved = { ...dispute, id:'WH-DISPUTE2', event_type:'CUSTOMER.DISPUTE.RESOLVED', resource:{...dispute.resource,dispute_outcome:{outcome_code:'RESOLVED_SELLER_FAVOUR'}} };
  await webhook(resolved);
  const audited = await inspectEvent(quota.id, resolved.id);
  assert.equal(audited.seen_event.dispute_outcome, 'RESOLVED_SELLER_FAVOUR');
  assert.equal(audited.record.status, 'REVIEW_REQUIRED');
  assert.equal((await (await dispatch('/v1/checkout/orders/' + q.id)).json()).order.status, 'REFUNDED');
  await webhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: q.paypal_order_id } }); assert.equal((await (await dispatch('/v1/checkout/orders/' + q.id)).json()).order.status, 'REFUNDED');
  captureMode = 'ok'; const declined = await create('provider-declined-event-order');
  await webhook({ event_type: 'PAYMENT.CAPTURE.DECLINED', resource: { id: declined.paypal_order_id } });
  assert.equal((await (await dispatch('/v1/checkout/orders/' + declined.id)).json()).order.status, 'REVIEW_REQUIRED');
  await webhook({ event_type: 'PAYMENT.CAPTURE.COMPLETED', resource: { id: declined.paypal_order_id } });
  assert.equal((await (await dispatch('/v1/checkout/orders/' + declined.id)).json()).order.status, 'REVIEW_REQUIRED', 'Late completion cannot release a declined-payment hold');
  await webhook({ event_type:'CHECKOUT.ORDER.VOIDED', resource:{id:declined.paypal_order_id} });
  assert.equal((await (await dispatch('/v1/checkout/orders/' + declined.id)).json()).order.error, 'provider_approval_reversed');
  for (let i = 0; i < 12; i++) await dispatch('/v1/checkout/orders', { body: input, key: 'daily-cap-fixture-order-' + i });
  assert.equal((await dispatch('/v1/checkout/orders', { body: input, key: 'daily-cap-final-fixture-order' })).status, 429);
  assert.equal((await dispatch('/openapi.json')).status, 200);
  assert.equal((await dispatch('/admin/paypal/ledger', { body: {} })).status, 401);
  const auth = { authorization: 'Bearer ' + fixtureOwner };
  const privatePage = await dispatch('/admin/paypal', { headers:auth });
  assert.equal(privatePage.status, 200);
  const ownerHtml = await privatePage.text();
  assert.ok(ownerHtml.includes('مدفوعات XGuard') && ownerHtml.includes('/admin/paypal/ledger'));
  assert.match(privatePage.headers.get('cache-control'), /no-store/);
  const logged = await dispatch('/admin/paypal/ledger', { body: {}, headers:auth });
  const healthPath = '/healthz?check=owner-report';
  assert.equal((await dispatch(healthPath)).status, 503, 'An untested release must not pass');
  await dispatch('/fixture/check-owner-report?missing-owner');
  const failedHealth = await dispatch(healthPath);
  assert.equal(failedHealth.status, 503);
  assert.equal((await failedHealth.json()).status, 'unavailable');
  assert.equal((await dispatch('/fixture/check-owner-report')).status, 200);
  const health = await dispatch(healthPath);
  assert.equal(health.status, 200);
  const marker = await health.json();
  assert.deepEqual(Object.keys(marker).sort(), ['checked_at', 'status', 'worker_id']);
  assert.equal(marker.status, 'verified');
  assert.equal(marker.worker_id, worker.bindings.CF_VERSION_METADATA.id);
  assert.equal(logged.status, 200); assert.deepEqual((await logged.json()).rows, [], 'Sandbox orders cannot enter the live owner report');
  assert.equal((await dispatch('/admin/paypal/ledger', { body:{after:'invalid/ref'}, headers:auth })).status, 400);
  const paidRow = { ...(await inspectEvent(q.id)).record, environment:'live' };
  const projected = financialRow(paidRow);
  assert.deepEqual([projected.captured_cents,projected.fee_cents,projected.refund_cents,projected.delivered], [200,40,200,true]);
  assert.ok(!('input' in projected) && !('token_hash' in projected) && !('paypal_order_id' in projected));
  assert.equal(financialRow({ ...paidRow, status:'REVIEW_REQUIRED', error:'provider_partial_refund_requires_reconciliation', confirmed_refund_cents:undefined }).refund_cents, null);
  const index = [paidRow.capture.id, paidRow.paypal_order_id];
  const stubEnv = { PAID_GATEWAY:{ idFromName: id => id, get: () => ({ fetch: async (url, init) => {
    if (url.endsWith('/inspect')) return Response.json({record:paidRow});
    const second = Boolean(JSON.parse(init.body).after);
    return Response.json({entries:[{ref:index[second ? 1 : 0],id:paidRow.id}],next:second ? null : index[0]});
  } }) } };
  const firstReport = await financePage(stubEnv, null), nextReport = await financePage(stubEnv, firstReport.next);
  assert.equal(firstReport.rows.length, 0); assert.deepEqual(nextReport.rows,[projected]); assert.equal(nextReport.next, null);
  console.log(JSON.stringify({ result: 'passed', scope: 'Real workerd SQLite and ES256; all provider calls simulated', verified: ['concurrent idempotency', 'tenant recovery isolation', 'no execution before capture', 'CSV result delivery', 'receipt signature', 'lost capture recovery without recapture', 'storage interruption after payment', 'exact amount validation', 'signed webhook boundary', 'webhook retries and permanent deduplication', 'cumulative completed refunds', 'disputes and late capture liability', 'daily capacity cap'], counts: count, real_payments: 0, real_sales: 0 }));
} finally { await mf.dispose(); await rm(dir, { recursive: true, force: true }); }
