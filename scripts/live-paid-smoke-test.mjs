import test from 'node:test';
import assert from 'node:assert/strict';
import { runPaidSmoke } from './live-paid-smoke.mjs';
const catalog = { public_facts_remain_free: true, services: [['batch', '10000'], ['history', '20000'], ['compare', '20000']].map(([route, amount_atomic]) => ({ route, price: { amount_atomic } })) };
const response = (body, status = 200, tag = 'git-current', extra = {}) => Response.json(body, { status, headers: { 'x-xguard-worker-version-tag': tag, ...extra } });
test('paid smoke waits for API revision propagation without submitting a payment', async () => {
  let reads = 0, posts = 0, waits = 0;
  const result = await runPaidSmoke({ expectedTag: 'git-current', pause: async () => { waits++; }, fetchImpl: async (url, init) => {
    assert.equal(init.headers['x-xguard-traffic-class'], 'synthetic'); assert.equal(init.headers['payment-signature'], undefined);
    if (url.endsWith('/catalog')) return response(catalog, 200, ++reads === 1 ? 'git-previous' : 'git-current');
    posts++; return response({ error: 'paid_service_not_ready', reasons: ['storage_write_quota_exhausted'] }, 503);
  } });
  assert.equal(reads, 2); assert.equal(waits, 1); assert.equal(posts, 1); assert.equal(result.payments_submitted, 0);
});
test('a standard unpaid challenge passes but an unsigned delivered result fails', async () => {
  const fetcher = paid => async url => url.endsWith('/catalog') ? response(catalog) : paid;
  assert.equal((await runPaidSmoke({ fetchImpl: fetcher(response({ x402Version: 2, accepts: [{ amount: '10000' }] }, 402, 'git-current', { 'payment-required': 'fixture' })) })).production_sale_proven, false);
  await assert.rejects(runPaidSmoke({ fetchImpl: fetcher(response({ result: { purchased: true } })) }), /Unsigned probes cannot receive/);
});
test('an API revision that never converges fails after bounded probes without a POST', async () => {
  let reads = 0, posts = 0;
  await assert.rejects(runPaidSmoke({ expectedTag: 'git-current', pause: async () => {}, fetchImpl: async (url, init) => { if (init.method === 'POST') posts++; reads++; return response(catalog, 200, 'git-previous'); } }), /did not converge/);
  assert.equal(reads, 6); assert.equal(posts, 0);
});
test('unknown dependency errors and non-JSON responses fail with bounded diagnostics', async () => {
  const fetcher = paid => async url => url.endsWith('/catalog') ? response(catalog) : paid;
  await assert.rejects(runPaidSmoke({ fetchImpl: fetcher(response({ error: 'unexpected_failure' }, 503)) }));
  await assert.rejects(runPaidSmoke({ fetchImpl: fetcher(new Response('Provider page', { status: 500, headers: { 'content-type': 'text/html' } })) }), /non-JSON: HTTP 500/);
});
