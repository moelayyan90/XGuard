import test from 'node:test';
import assert from 'node:assert/strict';
import { runActionSmoke } from './action-production-check.mjs';

function fixture({ staleCatalogOnce = false, alwaysStale = false, price = 200, status = 200 } = {}) {
  const calls = new Map();
  const fetchImpl = async (url, init) => {
    assert.equal(init.headers['x-xguard-traffic-class'], 'synthetic');
    assert.equal(init.headers['payment-signature'], undefined);
    assert.equal(init.headers['cache-control'], 'no-cache');
    const path = new URL(url).pathname;
    calls.set(path, (calls.get(path) || 0) + 1);
    const tag = alwaysStale || (staleCatalogOnce && path === '/v1/checkout/catalog' && calls.get(path) === 1)
      ? 'git-previous' : 'git-current';
    const headers = { 'x-xguard-worker-version-tag': tag };
    if (path === '/') return new Response('XGUARD ACTION CLOUD', { status, headers });
    if (path === '/v1/checkout/catalog') return Response.json({ name: 'XGuard Action Cloud', services: [{ id: 'csv-clean', card_amount_cents: 200 }], payment: { ready: false, blockers: ['merchant_activation_pending'] } }, { status, headers });
    if (path === '/v1/checkout/quote') {
      assert.equal(init.method, 'POST');
      assert.ok(JSON.parse(init.body).input.csv.includes('Synthetic smoke'));
      return Response.json({ amount_cents: price, currency: 'USD' }, { status, headers });
    }
    if (path === '/checkout') return new Response('Review final price', { status, headers });
    if (path === '/openapi.json') return Response.json({ paths: { '/v1/checkout/orders': {} } }, { status, headers });
    throw new Error('Unexpected payment or network action: ' + url);
  };
  return { fetchImpl, calls };
}
test('action smoke tolerates one stale read but insists on exact candidate revision and prices', async () => {
  const mock = fixture({ staleCatalogOnce: true });
  let pauses = 0;
  const r = await runActionSmoke({ fetchImpl: mock.fetchImpl, expectedTag: 'git-current', pause: async () => { pauses++; } });
  assert.equal(mock.calls.get('/v1/checkout/catalog'), 2);
  assert.equal(pauses, 1);
  assert.equal(r.real_payments, 0);
  assert.equal(r.card_ready, false);
});
test('action smoke fails closed if no edge converges to the intended version', async () => {
  const mock = fixture({ alwaysStale: true });
  await assert.rejects(runActionSmoke({ fetchImpl: mock.fetchImpl, expectedTag: 'git-current', pause: async () => {} }), /git-current/);
  assert.equal(mock.calls.get('/'), 8);
  assert.equal(mock.calls.get('/v1/checkout/quote') || 0, 0);
});
test('action smoke rejects invalid prices and HTTP failures after correct revision', async () => {
  await assert.rejects(runActionSmoke({ fetchImpl: fixture({ price: 1 }).fetchImpl, expectedTag: 'git-current', pause: async () => {} }));
  await assert.rejects(runActionSmoke({ fetchImpl: fixture({ status: 503 }).fetchImpl, expectedTag: 'git-current', pause: async () => {} }));
});
