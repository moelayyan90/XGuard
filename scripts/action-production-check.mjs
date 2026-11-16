import assert from 'node:assert/strict';
const origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuard-action-smoke/1.0', 'x-xguard-traffic-class': 'synthetic', 'cache-control': 'no-cache' };
async function read(path, body) {
  const r = await fetch(origin + path, { method: body ? 'POST' : 'GET', headers: { ...headers, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}), redirect: 'manual', signal: AbortSignal.timeout(15000) });
  assert.equal(r.status, 200, path);
  if (process.env.EXPECTED_XGUARD_TAG) assert.equal(r.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG, path);
  return r;
}
const home = await (await read('/')).text(); assert.match(home, /XGUARD ACTION CLOUD/);
const catalog = await (await read('/v1/checkout/catalog')).json();
assert.equal(catalog.name, 'XGuard Action Cloud'); assert.ok(catalog.services.some(s => s.id === 'csv-clean' && s.card_amount_cents === 200));
const quote = await (await read('/v1/checkout/quote', { service: 'csv-clean', input: { csv: 'email,name\nsmoke@example.com,Synthetic smoke\n' } })).json();
assert.equal(quote.amount_cents, 200); assert.equal(quote.currency, 'USD');
const checkout = await (await read('/checkout?service=csv-clean')).text(); assert.match(checkout, /Review final price/);
const spec = await (await read('/openapi.json')).json(); assert.ok(spec.paths['/v1/checkout/orders']);
console.log(JSON.stringify({ action_cloud: 'passed', services: catalog.services.length, card_ready: catalog.payment.ready, blockers: catalog.payment.blockers, completed_financial_canary: false, real_payments: 0, real_sales: 'not established by this read-only smoke' }));
