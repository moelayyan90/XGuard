import assert from 'node:assert/strict';
import { VERSION, NAME } from '../apps/relay/src/core/identity.js';

const api = 'https://api.xguardgate.com';
const expectedTag = process.env.EXPECTED_XGUARD_TAG;
const headers = { 'cache-control': 'no-cache', 'x-xguard-traffic-class': 'synthetic', 'user-agent': `xguard-governance-release/${VERSION}` };
async function request(path, body) {
  const url = new URL(path, api);
  if (expectedTag) url.searchParams.set('governance_release', expectedTag);
  const response = await fetch(url, { method: body ? 'POST' : 'GET', redirect: 'manual',
    headers: { ...headers, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(15000) });
  if (expectedTag) assert.equal(response.headers.get('x-xguard-worker-version-tag'), expectedTag, `Wrong build at ${path}`);
  return { status: response.status, body: await response.json() };
}

// All reads are public metadata. Rejection probes have no capability or payment
// credentials and therefore cannot dispatch a provider operation or spend funds.
const [identity, manifest, specification] = await Promise.all([
  request('/identity'), request('/v1/egress'), request('/openapi.json'),
]);
for (const response of [identity, manifest, specification]) assert.equal(response.status, 200);
assert.equal(identity.body.name, NAME);
assert.equal(identity.body.version, VERSION);
assert.equal(manifest.body.governance.mode, 'mandatory_external_capability_governance');
assert.equal(manifest.body.governance.secret_location, 'gateway_only');
assert.equal(specification.body['x-governance'].mode, manifest.body.governance.mode);
const grant = specification.body.paths['/v1/egress/capabilities'].post.requestBody.content['application/json'].schema;
assert.ok(grant.required.includes('governance'));
for (const path of ['/v1/egress/authorize', '/v1/egress/fetch', '/v1/egress/recover']) {
  const rejected = await request(path, { target: 'https://api.github.com/', method: 'GET', idempotency_key: 'release-denial-probe' });
  assert.equal(rejected.status, 401, `An unauthenticated request was not refused at ${path}`);
  assert.equal(rejected.body.error, 'valid_xguard_capability_required');
}
console.log(JSON.stringify({ ok: true, version: VERSION, governance: manifest.body.governance.mode,
  policy_required: true, unauthenticated_dispatch_refused: true, payment_made: false,
  deployment_isolation_verified: false, note: 'Agent host isolation is a separate operator deployment.' }));
