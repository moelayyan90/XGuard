import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { validateDiscoveryExtension } from '@x402/extensions/bazaar';
import app from '../src/live-entry.js';
import live from '../src/live/worker.ts';
import { PaidGatewayState, ProofAuthority, livePaidState } from '../src/paid-agent-entry.js';
import { environment, seed } from './live-harness.mjs';
import { normalizeLivePaid, LIVE_PAID, executeLivePaid } from '../src/live/paid-data.ts';
import { hash } from '../src/live/util.ts';
import { parseHTML } from 'linkedom';
import { verifyLiveDelivery } from '../../../sdk/live-paid.js';

class Storage {
  values = new Map();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k, v) { this.values.set(k, structuredClone(v)); }
  async delete(k) { this.values.delete(k); }
  async setAlarm() {}
  async transaction(fn) { return fn(this); }
}
function namespace(Class, env) {
  const objects = new Map();
  return { idFromName: n => n, get(id) {
    if (!objects.has(id)) {
      const object = new Class({ storage: new Storage() }, env); let pending = Promise.resolve();
      objects.set(id, { fetch(input, init) { const next = pending.then(() => object.fetch(input instanceof Request ? input : new Request(input, init))); pending = next.catch(() => {}); return next; } });
    }
    return objects.get(id);
  } };
}
const BASE = 'https://api.xguardgate.com/api/paid/v1';
const PAYER = '0x1111111111111111111111111111111111111111';
async function fixture(t, options = {}) {
  const h = environment({ XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_TREASURY_USDC_ADDRESS: '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07', XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0', XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100', XGUARD_MIN_CONTRIBUTION_BPS: '2000', LIVE_PAID_SERVICES: 'on' });
  h.env.PAID_GATEWAY = namespace(PaidGatewayState, h.env); h.env.PROOF_AUTHORITY = namespace(ProofAuthority, h.env);
  await seed(h, '1.0.0', '2026-10-01T00:00:00.000Z'); await seed(h, '2.0.0');
  const counts = { verify: 0, settle: 0 }, original = globalThis.fetch;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input instanceof Request ? input.url : input);
    assert.equal(url.hostname, 'facilitator.test', 'Fixtures must never call a live payment or source provider');
    if (url.pathname === '/supported') return Response.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
    const body = JSON.parse(init.body);
    if (url.pathname === '/verify') { counts.verify++; if (options.verifyUnavailable) throw new Error('fixture outage'); return Response.json({ isValid: !options.invalidSignature, payer: PAYER }); }
    assert.equal(url.pathname, '/settle'); counts.settle++;
    if (options.settleUnavailable) throw new Error('fixture settlement timeout');
    return Response.json({ success: !options.settleRejected, payer: PAYER, network: 'eip155:8453', transaction: `0x${'2'.repeat(64)}` });
  };
  t.after(async () => { try { await h.drain(); } finally { globalThis.fetch = original; h.close(); } });
  const request = (path, body, headers = {}) => app.fetch(new Request(`${BASE}${path}`, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', 'x-xguard-traffic-class': 'synthetic', ...headers }, body: body === undefined ? undefined : JSON.stringify(body) }), h.env, h.ctx);
  let nonce = 0;
  const challenge = async (service = 'batch', key = crypto.randomUUID(), overrides = {}) => {
    const body = { ...LIVE_PAID.find(d => d.route === service).example, ...overrides };
    const first = await request(`/${service}`, body, { 'idempotency-key': key }); const c = await first.json(); assert.equal(first.status, 402, JSON.stringify(c));
    const payment = { x402Version: 2, resource: c.resource, accepted: c.accepts[0], extensions: c.extensions, payload: { signature: `0x${'1'.repeat(130)}`, authorization: { from: PAYER, to: c.accepts[0].payTo, value: c.accepts[0].amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${(++nonce).toString(16).padStart(64, '0')}` } } };
    const headers = { 'idempotency-key': key, 'x-xguard-quote': first.headers.get('x-xguard-quote'), 'payment-signature': encodePaymentSignatureHeader(payment) };
    return { c, body, payment, headers, quote: headers['x-xguard-quote'], send: extra => request(`/${service}`, body, { ...headers, ...extra }) };
  };
  return { ...h, request, counts, challenge };
}

test('all existing public GET representations delegate to the original Live router', async t => {
  const h = await fixture(t);
  const paths = ['/', '/topics', '/topics/javascript-packages', '/search?q=react', '/live/npm/react', '/fact/npm/react/latest-version', '/history/npm/react/latest-version', '/changes', '/changes/npm/react', '/changes.atom', '/sitemap.xml', '/sitemaps/site.xml', '/sitemaps/facts-0-1.xml', '/robots.txt', '/llms.txt', '/identity', '/.well-known/xguard-live.json', '/methodology', '/accuracy', '/sources', '/privacy', '/terms', '/corrections', '/status', '/healthz', '/pricing', '/mcp', '/v1/payment/readiness'];
  for (const path of paths) for (const accept of ['application/json', 'text/html', 'text/markdown']) {
    const request = () => new Request(`https://xguardgate.com${path}`, { headers: { accept, 'user-agent': 'XGuardLiveSmoke/1.0' } });
    const before = await live.fetch(request(), h.env, h.ctx), after = await app.fetch(request(), h.env, h.ctx);
    assert.equal(after.status, before.status, `${path} ${accept}`);
    assert.equal(after.headers.get('content-type'), before.headers.get('content-type'));
    assert.equal(after.headers.has('payment-required'), false);
    assert.notEqual(after.status, 402);
    const a = await before.text(), b = await after.text();
    if (before.headers.get('content-type')?.startsWith('text/html')) {
      const parse = text => { const { document } = parseHTML(text); return { text: document.body.textContent, canonical: document.querySelector('link[rel="canonical"]')?.getAttribute('href'), schemas: [...document.querySelectorAll('script[type="application/ld+json"]')].map(x => JSON.parse(x.textContent)) }; };
      assert.deepEqual(parse(b), parse(a));
    } else assert.equal(b, a);
  }
  assert.equal(app.scheduled, live.scheduled); assert.equal(h.counts.verify, 0); assert.equal(h.counts.settle, 0);
});
test('buyer budgets, canonical inputs, body size and request identifiers fail before payment', async t => {
  const h = await fixture(t);
  for (const body of [{ facts: ['npm/react/latest-version'], max_amount_atomic: '9999' }, { facts: ['https://127.0.0.1/'], max_amount_atomic: '10000' }, { facts: Array(21).fill('npm/react/latest-version'), max_amount_atomic: '10000' }, { ...LIVE_PAID[0].example, op: 'set' }]) assert.equal((await h.request('/batch', body, { 'idempotency-key': 'bounded-test-1' })).status, 400);
  assert.equal((await h.request('/batch', LIVE_PAID[0].example)).status, 400);
  assert.throws(() => normalizeLivePaid('history', { ...LIVE_PAID[1].example, limit: 301 }));
  assert.equal((await h.request('/batch', { facts: ['x'.repeat(17000)], max_amount_atomic: '10000' }, { 'idempotency-key': 'bounded-test-1' })).status, 413);
  assert.equal(h.counts.settle, 0);
});
test('unpaid calls issue standard x402 v2 challenges and expose no purchased result', async t => {
  const h = await fixture(t); const q = await h.challenge();
  assert.equal(q.c.x402Version, 2); assert.equal(q.c.accepts[0].amount, '10000'); assert.equal(q.c.resource.url, `${BASE}/batch`); assert.equal(q.c.result, undefined);
  assert.ok(q.quote); assert.equal(q.c.extensions.xguard.proofKey, `${BASE}/proof-key`);
  for (const service of ['batch', 'history', 'compare']) {
    const challenge = service === 'batch' ? q : await h.challenge(service);
    const metadata = challenge.c.extensions.bazaar;
    assert.equal(validateDiscoveryExtension(metadata).valid, true);
    assert.equal(normalizeLivePaid(service, metadata.info.input.body).capability, `live-${service}`);
    assert.equal(metadata.info.output.example.receipt.example_only, true);
  }
  assert.equal(h.counts.verify, 0); assert.equal(h.counts.settle, 0);
});
test('concurrent retries settle once, return signed source evidence, and recover without another charge', async t => {
  const h = await fixture(t); const q = await h.challenge();
  const results = await Promise.all(Array.from({ length: 8 }, () => q.send()));
  assert.ok(results.some(r => r.status === 200)); assert.equal(h.counts.settle, 1);
  const replay = await q.send(); assert.equal(replay.status, 200); assert.equal(replay.headers.get('x-xguard-replay'), 'true');
  const delivered = await replay.json(); assert.equal(delivered.result.rows[0].fact.current_value, '2.0.0'); assert.equal(delivered.result.rows[1].status, 'UNKNOWN');
  assert.ok(delivered.receipt.signature); assert.ok(delivered.proofrail.proof);
  const key = await (await h.request('/proof-key')).json(); assert.equal(await verifyLiveDelivery(delivered, key.jwk), true);
  const corrupted = structuredClone(delivered); corrupted.result.rows[0].fact.current_value = 'tampered'; assert.equal(await verifyLiveDelivery(corrupted, key.jwk), false);
  const verify = await h.request('/verify-receipt', { receipt: delivered.receipt.signature, proof: delivered.proofrail.proof }); const proof = await verify.json(); assert.equal(proof.valid, true); assert.equal(proof.proof.body_sha256, await hash(JSON.stringify(delivered.result)));
  const tampered = await h.request('/verify-receipt', { receipt: delivered.receipt.signature.slice(0, -5) + 'xxxxx', proof: delivered.proofrail.proof }); assert.equal((await tampered.json()).valid, false);
  const recovered = await h.request(`/results/${q.c.extensions.xguard.paymentIdentifier}`, undefined, { 'x-xguard-quote': q.quote }); assert.equal(recovered.status, 200); assert.equal(h.counts.settle, 1);
  const summary = await livePaidState(h.env, '/live/summary'); assert.equal(summary.commerce, null, 'Synthetic fixtures must never become observed commercial revenue');
});
test('a fresh authorization cannot charge again for an already reserved buyer idempotency key', async t => {
  const h = await fixture(t); const key = 'same-purchase-001'; const q = await h.challenge('batch', key); assert.equal((await q.send()).status, 200);
  const other = await h.challenge('batch', key); const r = await other.send(); assert.equal(r.status, 409); assert.equal(h.counts.settle, 1);
});
test('a simulated settled Live failure redeems its credit and recovers a signed result without a new charge', async t => {
  const h = await fixture(t); const q = await h.challenge('batch', 'credit-recovery-001');
  const readers = [...h.objects.values()].map(object => [object.store, object.store.paidRead]);
  for (const [store] of readers) store.paidRead = () => { throw new Error('temporary fixture read failure'); };
  const failed = await q.send({ 'x-xguard-traffic-class': 'external' }); assert.equal(failed.status, 502);
  const credit = (await failed.json()).error.details.execution_credit; assert.ok(credit);
  const pending = await livePaidState(h.env, '/live/summary');
  assert.equal(pending.confirmed_cash_usdc_atomic, 10000); assert.equal(pending.unfulfilled_usdc_atomic, 10000); assert.equal(pending.recognized_revenue_usdc_atomic, 0);
  for (const [store, reader] of readers) store.paidRead = reader;
  const headers = { 'idempotency-key': 'credit-recovery-001', 'x-xguard-quote': q.quote, 'x-xguard-credit': credit, 'x-xguard-traffic-class': 'external' };
  const redeemed = await h.request('/batch', q.body, headers); assert.equal(redeemed.status, 200, await redeemed.clone().text());
  const delivery = await redeemed.json(); assert.equal(delivery.used_execution_credit, true); assert.equal(delivery.cost.new_charge, false);
  const key = await (await h.request('/proof-key')).json(); assert.equal(await verifyLiveDelivery(delivery, key.jwk), true);
  assert.equal((await h.request('/batch', q.body, headers)).status, 200);
  const recovered = await h.request(`/results/${q.c.extensions.xguard.paymentIdentifier}`, undefined, { 'x-xguard-quote': q.quote }); assert.equal(recovered.status, 200);
  const final = await livePaidState(h.env, '/live/summary');
  assert.equal(final.confirmed_cash_usdc_atomic, 10000); assert.equal(final.recognized_revenue_usdc_atomic, 10000); assert.equal(final.unfulfilled_usdc_atomic, 0); assert.equal(final.signed_results_delivered, 1);
  assert.equal(h.counts.settle, 1);
});
test('wrong amount, destination, nonce reuse and cross-service quotes cannot buy data', async t => {
  const h = await fixture(t); const q = await h.challenge();
  for (const patch of [{ value: '1' }, { to: PAYER }]) {
    const payment = structuredClone(q.payment); Object.assign(payment.payload.authorization, patch);
    assert.equal((await q.send({ 'payment-signature': encodePaymentSignatureHeader(payment) })).status, 400);
  }
  assert.equal((await h.request('/compare', LIVE_PAID[2].example, q.headers)).status, 400); assert.equal(h.counts.settle, 0);
});
test('settlement outage creates no delivered receipt and does not disrupt free facts', async t => {
  const h = await fixture(t, { settleUnavailable: true }); const q = await h.challenge(); const r = await q.send(); assert.equal(r.status, 503); const b = await r.json(); assert.equal(b.receipt, undefined);
  const replay = await q.send(); assert.ok(replay.status >= 400); assert.equal(h.counts.settle, 1);
  const free = await app.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version', { headers: { accept: 'application/json' } }), h.env, h.ctx); assert.equal(free.status, 200);
  assert.equal((await livePaidState(h.env, '/live/summary')).commerce, null);
});
test('invalid financial authorization never settles or returns purchased data', async t => {
  const h = await fixture(t, { invalidSignature: true }); const q = await h.challenge(); const r = await q.send();
  assert.equal(r.status, 402); assert.equal((await r.json()).result, undefined); assert.equal(h.counts.settle, 0);
});
test('paid circuit pauses repeated delivery failures while public facts remain available', async t => {
  const h = await fixture(t);
  for (const object of h.objects.values()) object.store.paidRead = () => { throw new Error('fixture data failure'); };
  for (let i = 0; i < 3; i++) { const q = await h.challenge('batch', `failed-delivery-${i}`); assert.equal((await q.send()).status, 502); await h.drain(); }
  const circuit = await livePaidState(h.env, '/live/circuit'); assert.ok(circuit.paused_until > Date.now());
  const next = await h.request('/batch', LIVE_PAID[0].example, { 'idempotency-key': 'after-circuit-001' }); assert.equal(next.status, 503); assert.equal(h.counts.settle, 3);
  assert.equal((await app.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version'), h.env, h.ctx)).status, 200);
});
test('rolling back activation to the supporting configuration keeps paid recovery and free pages', async t => {
  const h = await fixture(t); const q = await h.challenge(); assert.equal((await q.send()).status, 200);
  h.env.LIVE_PAID_SERVICES = 'off';
  assert.equal((await h.request('/batch', LIVE_PAID[0].example, { 'idempotency-key': 'disabled-purchase-001' })).status, 503);
  const oldNow = Date.now; Date.now = () => oldNow() + 600000;
  try { assert.equal((await h.request(`/results/${q.c.extensions.xguard.paymentIdentifier}`, undefined, { 'x-xguard-quote': q.quote })).status, 200); } finally { Date.now = oldNow; }
  assert.equal(h.counts.settle, 1); assert.equal((await app.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version'), h.env, h.ctx)).status, 200);
});
test('Live commerce counts a simulated external delivered settlement once, separately from attempts', async t => {
  const h = await fixture(t); const q = await h.challenge();
  assert.equal((await q.send({ 'x-xguard-traffic-class': 'external' })).status, 200);
  assert.equal((await q.send({ 'x-xguard-traffic-class': 'external' })).status, 200);
  const summary = await livePaidState(h.env, '/live/summary'); assert.equal(summary.confirmed_cash_usdc_atomic, 10000); assert.equal(summary.recognized_revenue_usdc_atomic, 10000); assert.equal(summary.signed_results_delivered, 1); assert.equal(summary.net_profit_usd, null);
});
test('history and comparison use existing immutable, time-bounded source observations', async t => {
  const h = await fixture(t);
  const from = '2026-10-01T00:00:00.000Z', to = new Date().toISOString();
  const history = await executeLivePaid(normalizeLivePaid('history', { fact: 'npm/react/latest-version', from, to, limit: 1, max_amount_atomic: '20000' }), h.env);
  const row = history.data.rows[0]; assert.equal(row.observations.length, 1); assert.equal(row.has_more, true); assert.ok(row.next_cursor);
  const next = await executeLivePaid(normalizeLivePaid('history', { fact: 'npm/react/latest-version', from, to, limit: 1, cursor: row.next_cursor, max_amount_atomic: '20000' }), h.env); assert.equal(next.data.rows[0].observations[0].value, '1.0.0');
  const compared = await executeLivePaid(normalizeLivePaid('compare', { fact: 'npm/react/latest-version', from, to, max_amount_atomic: '20000' }), h.env);
  assert.equal(compared.data.rows[0].before.value, '1.0.0'); assert.equal(compared.data.rows[0].after.value, '2.0.0'); assert.equal(compared.data.rows[0].changed, true);
  const unknown = await executeLivePaid(normalizeLivePaid('compare', { fact: 'npm/react/latest-version', from: '2020-01-01T00:00:00Z', to, max_amount_atomic: '20000' }), h.env); assert.equal(unknown.data.rows[0].changed, null);
});
test('new financial counters remain private and unavailable records display UNKNOWN', async t => {
  const h = await fixture(t); const url = 'https://xguardgate.com/admin/paid-revenue';
  assert.equal((await app.fetch(new Request(url), h.env, h.ctx)).status, 401);
  const r = await app.fetch(new Request(url, { headers: { authorization: `Bearer ${h.env.LIVE_ADMIN_KEY}` } }), h.env, h.ctx); assert.equal(r.status, 200); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.equal((await r.json()).net_profit_usd, null);
  h.env.PAID_GATEWAY = { idFromName: x => x, get() { throw new Error('quota fixture'); } };
  const unknown = await app.fetch(new Request(url, { headers: { authorization: `Bearer ${h.env.LIVE_ADMIN_KEY}` } }), h.env, h.ctx); assert.equal((await unknown.json()).status, 'UNKNOWN');
});
test('origin latency histograms keep overflow unknown and attempts distinct from cash', async t => {
  const h = await fixture(t);
  for (const duration_ms of [130000, 2, 3]) await livePaidState(h.env, '/live/response', { service: 'batch', status: 503, duration_ms });
  const summary = await livePaidState(h.env, '/live/summary');
  assert.equal(summary.http.services.batch.p50_origin_ms_upper_bound, 5);
  assert.equal(summary.http.services.batch.p95_origin_ms_upper_bound, null);
  assert.equal(summary.http.services.batch.statuses[503], 3);
  assert.equal(summary.confirmed_cash_usdc_atomic, null);
});
