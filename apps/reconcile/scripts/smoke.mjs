import assert from 'node:assert/strict';
const base = 'https://reconcile.xguardgate.com';
const get = path => fetch(base + path, { headers: { accept: 'application/json', 'user-agent': 'XGuardReconcileSmoke/1.0 (synthetic; no payment)' }, redirect: 'error', signal: AbortSignal.timeout(18000) });
if (process.env.EXPECTED_RECONCILE_TAG) {
  let revision;
  for (let attempt = 0; attempt < 6; attempt++) {
    const response = await get('/healthz'); revision = response.headers.get('x-xguard-reconcile-revision'); await response.body?.cancel();
    if (revision === process.env.EXPECTED_RECONCILE_TAG) break;
    if (attempt < 5) await new Promise(resolve => setTimeout(resolve, 5000));
  }
  assert.equal(revision, process.env.EXPECTED_RECONCILE_TAG, 'Reconcile revision did not propagate within the bounded deadline');
}
for (const [path, status] of [['/healthz', 200], ['/docs', 200], ['/openapi.json', 200], ['/.well-known/x402.json', 200], ['/not-a-route', 404], ['/v1/reconcile?from=bad&nonce=bad', 400], ['/v1/reconcile', 402]]) {
  const response = await get(path); assert.equal(response.status, status, path);
  if (process.env.EXPECTED_RECONCILE_TAG) assert.equal(response.headers.get('x-xguard-reconcile-revision'), process.env.EXPECTED_RECONCILE_TAG, path);
  await response.body?.cancel();
}
const nonce = '0x' + '1'.repeat(64), from = '0x' + '1'.repeat(40);
const response = await get(`/v1/reconcile?from=${from}&nonce=${nonce}`);
assert.equal(response.status, 402, await response.clone().text());
const challenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString());
assert.equal(challenge.x402Version, 2); assert.equal(challenge.accepts[0].amount, '2000'); assert.equal(challenge.accepts[0].network, 'eip155:8453'); assert.equal(challenge.accepts[0].asset.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'); assert.ok(challenge.extensions.bazaar.schema);
console.log(JSON.stringify({ reconcile_contract: 'passed', protected_purchase: 'challenge-ready-no-sale-proven', payments_submitted: 0, production_sale_proven: false }));
