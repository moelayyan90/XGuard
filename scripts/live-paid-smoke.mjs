import assert from 'node:assert/strict';
const base = 'https://api.xguardgate.com/api/paid/v1';
const headers = { accept: 'application/json', 'user-agent': 'XGuardLiveSmoke/1.0', 'x-xguard-traffic-class': 'synthetic' };
const get = (path, init = {}) => fetch(`${base}${path}`, { ...init, headers: { ...headers, ...init.headers }, redirect: 'error', signal: AbortSignal.timeout(15000) });
const catalogResponse = await get('/catalog'); assert.equal(catalogResponse.status, 200);
if (process.env.EXPECTED_XGUARD_TAG) assert.equal(catalogResponse.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG);
const catalog = await catalogResponse.json(); assert.equal(catalog.public_facts_remain_free, true); assert.equal(catalog.services.length, 3);
assert.deepEqual(catalog.services.map(x => [x.route, x.price.amount_atomic]), [['batch', '10000'], ['history', '20000'], ['compare', '20000']]);
const unpaid = await get('/batch', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `monitor-${crypto.randomUUID()}` }, body: JSON.stringify({ facts: ['npm/react/latest-version'], max_amount_atomic: '10000' }) });
const result = await unpaid.json();
assert.equal(result.result, undefined, 'Unsigned probes cannot receive a purchased result');
assert.equal(result.receipt, undefined, 'Unsigned probes cannot produce a paid receipt');
assert.ok([402, 503].includes(unpaid.status), JSON.stringify(result));
if (unpaid.status === 402) { assert.equal(result.x402Version, 2); assert.equal(result.accepts[0].amount, '10000'); assert.ok(unpaid.headers.get('payment-required')); }
else assert.ok(['paid_services_paused', 'paid_service_not_ready', 'paid_circuit_open', 'storage_request_quota_exhausted', 'storage_read_quota_exhausted', 'storage_write_quota_exhausted', 'paid_dependency_unavailable'].includes(result.error), JSON.stringify(result));
console.log(JSON.stringify({ paid_contract: 'passed', purchase_availability: unpaid.status === 402 ? 'challenge-ready-no-sale-proven' : 'blocked-no-payment-accepted', blocked_reason: result.reasons || result.error || null, payments_submitted: 0, production_sale_proven: false }));
