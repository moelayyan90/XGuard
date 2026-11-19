import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';

const key = process.env.LIVE_ADMIN_KEY;
const origin = 'https://xguardgate.com';
const headers = { 'user-agent': 'XGuard-owner-finance-check/1.0', 'x-xguard-traffic-class': 'synthetic', 'content-type': 'application/json' };
const options = { method: 'POST', redirect: 'error', body: '{}', headers };
const denied = await fetch(origin + '/admin/paypal/ledger', { ...options, signal: AbortSignal.timeout(15000) });
assert.equal(denied.status, 401);
const expectedTag = process.env.EXPECTED_XGUARD_TAG;
if (expectedTag) assert.equal(denied.headers.get('x-xguard-worker-version-tag'), expectedTag);
const workerId = denied.headers.get('x-xguard-worker-version-id');
assert.match(workerId || '', /^[0-9a-f-]{36}$/i);
if (!key) {
  // The production cron uses the real owner handler and ledger. Only its status is public.
  // Wait for a full ten-minute trigger interval and allow time for completion.
  const deadline = Date.now() + 12 * 60000;
  for (;;) {
    const res = await fetch(origin + '/healthz?check=owner-report', { headers, redirect: 'error', signal: AbortSignal.timeout(20000) });
    const check = await res.json();
    assert.equal(res.headers.get('x-xguard-worker-version-id'), workerId);
    assert.equal(check.worker_id, workerId);
    assert.match(res.headers.get('cache-control') || '', /no-store/);
    assert.deepEqual(Object.keys(check).sort(), ['checked_at', 'status', 'worker_id']);
    if (check.status === 'verified') {
      assert.equal(res.status, 200);
      assert.ok(Math.abs(Date.now() - Date.parse(check.checked_at)) < 75 * 60000);
      break;
    }
    assert.ok(res.status === 503 && check.status === 'pending', 'Production owner report check failed');
    assert.ok(Date.now() < deadline, 'No current authenticated production report check received');
    await wait(20000);
  }
  console.log('Anonymous ledger access denied; production scheduler verified the owner page and bounded private ledger on the active Worker.');
} else {
  assert.ok(key.length >= 24, 'Configured owner report credential is invalid');
  await checkWithOwnerKey();
}

async function checkWithOwnerKey() {
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
}
