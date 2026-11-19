import assert from 'node:assert/strict';

const key = process.env.LIVE_ADMIN_KEY;
assert.ok(key && key.length >= 24, 'Owner report credential unavailable');
const origin = 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuard-owner-finance-check/1.0', 'x-xguard-traffic-class': 'synthetic', 'content-type': 'application/json' };
const options = { method: 'POST', redirect: 'error', body: '{}', headers };
const denied = await fetch(origin + '/admin/paypal/ledger', { ...options, signal: AbortSignal.timeout(15000) });
assert.equal(denied.status, 401);
const result = await fetch(origin + '/admin/paypal/ledger', { ...options, headers: { ...headers, authorization: 'Bearer ' + key }, signal: AbortSignal.timeout(25000) });
assert.equal(result.status, 200, 'Live order index unreadable');
if (process.env.EXPECTED_XGUARD_TAG) assert.equal(result.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG);
assert.match(result.headers.get('cache-control') || '', /no-store/);
const data = await result.json();
assert.equal(data.scope, 'mapped_xguard_paypal_live_orders');
assert.ok(Array.isArray(data.rows) && data.rows.length <= 12);
assert.ok(data.next === null || /^[A-Z0-9]{8,32}$/.test(data.next));
for (const row of data.rows) {
  assert.ok(!Object.hasOwn(row, 'input') && !Object.hasOwn(row, 'paypal_order_id') && !Object.hasOwn(row, 'token_hash'));
  assert.ok(row.captured_cents === null || Number.isSafeInteger(row.captured_cents));
}
console.log('Owner report authenticated, bounded and private. No financial details logged and no provider transaction submitted.');
