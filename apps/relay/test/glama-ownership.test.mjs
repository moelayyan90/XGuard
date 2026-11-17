import test from 'node:test';
import assert from 'node:assert/strict';
import { GLAMA_SCHEMA, GLAMA_ORIGINS, GLAMA_PROOF_PATHS, glamaOwnershipFetch, validGlamaClaim, requireGlamaClaim } from '../src/glama-ownership.js';

// Deliberately synthetic: isolated tests only, never a deployment default.
const fixtureClaim = 'glama_claim_' + 'T'.repeat(32);
const proof = { $schema: GLAMA_SCHEMA, claim: fixtureClaim };
const env = { CF_VERSION_METADATA: { id: 'fixture-version', tag: 'fixture-tag' } };

test('Glama proof is exact public JSON on both origins and endpoint proof URLs', async () => {
  for (const origin of GLAMA_ORIGINS) for (const path of GLAMA_PROOF_PATHS) {
    const response = glamaOwnershipFetch(new Request(origin + path, { headers: { accept: 'text/html', authorization: 'Bearer irrelevant' } }), env, proof);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), /^application\/json/);
    assert.equal(response.headers.has('location'), false);
    assert.equal(response.headers.has('www-authenticate'), false);
    assert.equal(response.headers.get('strict-transport-security'), 'max-age=31536000; includeSubDomains');
    assert.equal(response.headers.get('x-xguard-worker-version-id'), 'fixture-version');
    assert.equal(response.headers.get('x-xguard-worker-version-tag'), 'fixture-tag');
    const body = await response.json();
    assert.equal(body.$schema, GLAMA_SCHEMA);
    assert.ok(body.claim === fixtureClaim, 'The proof must preserve the configured token exactly');
    assert.deepEqual(Object.keys(body).sort(), ['$schema', 'claim']);
    const head = glamaOwnershipFetch(new Request(origin + path, { method: 'HEAD' }), env, proof);
    assert.equal(head.status, 200); assert.equal(await head.text(), '');
    assert.deepEqual([...head.headers], [...response.headers]);
  }
});

test('missing, legacy email and malformed claims never become a successful ownership proof', async () => {
  for (const claim of [undefined, null, '', 'GLAMA_ACTUAL_CLAIM_TOKEN', 'glama_claim_...', 'owner@example.org', fixtureClaim + '\n', 'glama_claim_' + 'x'.repeat(31), ['glama_claim_' + 'x'.repeat(32)]]) {
    assert.equal(validGlamaClaim(claim), false);
    assert.throws(() => requireGlamaClaim(claim), /owner-issued GLAMA_CLAIM_TOKEN/);
    for (const method of ['GET', 'HEAD']) {
      const response = glamaOwnershipFetch(new Request(GLAMA_ORIGINS[0] + GLAMA_PROOF_PATHS[0], { method }), {}, { $schema: GLAMA_SCHEMA, claim });
      assert.equal(response.status, 503);
      assert.equal(response.headers.get('cache-control'), 'no-store');
      assert.equal(response.headers.get('retry-after'), '300');
      if (method === 'HEAD') assert.equal(await response.text(), '');
      else assert.deepEqual(await response.json(), { error: 'glama_claim_not_configured' });
    }
  }
});

test('proof routing is narrow, read-only and independent of quota-limited bindings', async () => {
  for (const url of ['https://unrelated.example/.well-known/glama.json', 'http://xguardgate.com/.well-known/glama.json', 'https://xguardgate.com/.well-known/other.json', 'https://xguardgate.com/mcp', 'https://xguardgate.com/settle']) {
    assert.equal(glamaOwnershipFetch(new Request(url), env), null);
  }
  const path = GLAMA_ORIGINS[0] + GLAMA_PROOF_PATHS[0];
  const options = glamaOwnershipFetch(new Request(path, { method: 'OPTIONS' }), {});
  assert.equal(options.status, 204); assert.equal(await options.text(), '');
  for (const method of ['POST', 'PUT', 'DELETE']) {
    const response = glamaOwnershipFetch(new Request(path, { method }), env);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'GET, HEAD, OPTIONS');
    assert.equal((await response.json()).claim, undefined);
  }
  const noStorage = new Proxy(env, { get(target, key) {
    if (['LIVE_SHARDS', 'LIVE_CONTROL', 'PAID_GATEWAY', 'XGUARD_SETTLEMENT'].includes(key)) throw Error('Ownership proof cannot access storage or settlement');
    return target[key];
  } });
  assert.equal(glamaOwnershipFetch(new Request(path), noStorage).status, 200);
});
