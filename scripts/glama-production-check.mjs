import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { GLAMA_SCHEMA, GLAMA_ORIGINS, GLAMA_PROOF_PATHS, GLAMA_OWNERSHIP, requireGlamaClaim } from '../apps/relay/src/glama-ownership.js';

export async function runGlamaProductionCheck({ claim = GLAMA_OWNERSHIP.claim, fetcher = fetch, expectedTag = process.env.EXPECTED_XGUARD_TAG } = {}) {
  requireGlamaClaim(claim);
  const checks = [];
  for (const origin of GLAMA_ORIGINS) for (const path of GLAMA_PROOF_PATHS) {
    const response = await fetcher(origin + path, { redirect: 'manual', signal: AbortSignal.timeout(12000), headers: { 'user-agent': 'XGuard-Glama-smoke/1.0 (operational; not monetizable)', accept: 'application/json' } });
    assert.equal(response.status, 200, 'Glama proof must return HTTP 200 without redirects or authentication');
    assert.match(response.headers.get('content-type') || '', /^application\/json\b/i, 'Glama proof must be JSON');
    assert.equal(response.headers.has('location'), false, 'Glama proof cannot redirect');
    assert.equal(response.headers.has('www-authenticate'), false, 'Glama proof must remain public');
    if (expectedTag) assert.ok(response.headers.get('x-xguard-worker-version-tag') === expectedTag, 'Glama proof revision differs from the release');
    let body;
    try { body = await response.json(); } catch { throw Error('Glama proof is not valid JSON'); }
    assert.ok(body && typeof body === 'object' && body.$schema === GLAMA_SCHEMA, 'Glama proof schema is invalid');
    assert.ok(body.claim === claim, 'Glama proof differs from the owner-supplied claim');
    assert.ok(!('maintainers' in body), 'Legacy email ownership declarations must not be published');
    checks.push({ origin, path, status: response.status, owner_claim_matches: true, version: response.headers.get('x-xguard-worker-version-id') });
  }
  return { glama_proof: 'passed', checks, ownership_accepted_by_glama: 'requires_confirmation_in_glama', payments_submitted: 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) console.log(JSON.stringify(await runGlamaProductionCheck()));
