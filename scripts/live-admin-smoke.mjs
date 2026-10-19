import assert from 'node:assert/strict';
const key = process.env.LIVE_ADMIN_KEY || process.env.LIVE_BOOTSTRAPPED_ADMIN_KEY;
if (!key || key.length < 24) {
  console.log('Owner credential unavailable in CI; authenticated admin check not performed. Existing Worker secrets are retained.');
} else {
  const origin = process.env.LIVE_ORIGIN || 'https://xguardgate.com';
  const headers = { authorization: `Bearer ${key}`, accept: 'application/json', 'user-agent': 'XGuardLive-admin-smoke/6.0', 'content-type': 'application/json' };
  const response = await fetch(origin + '/admin', { headers, signal: AbortSignal.timeout(25000) });
  assert.equal(response.status, 200, 'Owner authentication failed');
  const body = await response.json(); assert.ok(body.stats); assert.ok(body.state.config);
  const bootstrap = await fetch(origin + '/admin/bootstrap', { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(25000) });
  assert.equal(bootstrap.status, 200, 'Bootstrap failed');
  console.log(JSON.stringify({ owner_access: 'verified', curated_collection: 'queued', monetization_mode: body.state.config.mode, paid_test_requests: 0 }));
}
