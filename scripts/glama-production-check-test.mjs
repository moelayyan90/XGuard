import test from 'node:test';
import assert from 'node:assert/strict';
import { runGlamaProductionCheck } from './glama-production-check.mjs';
import { GLAMA_SCHEMA } from '../apps/relay/src/glama-ownership.js';
const claim = 'glama_claim_' + 'T'.repeat(32);
const proof = { $schema: GLAMA_SCHEMA, claim };

test('production gate requires exact owner proof and never reports Glama acceptance from HTTP alone', async () => {
  let requests = 0;
  const result = await runGlamaProductionCheck({ claim, expectedTag: 'git-test', fetcher: async (url, options) => {
    requests++; assert.equal(options.redirect, 'manual');
    assert.equal(options.headers.authorization, undefined);
    assert.ok(!url.includes(claim));
    return Response.json(proof, { headers: { 'x-xguard-worker-version-tag': 'git-test' } });
  } });
  assert.equal(requests, 4);
  assert.equal(result.glama_proof, 'passed');
  assert.equal(result.ownership_accepted_by_glama, 'requires_confirmation_in_glama');
  assert.ok(!JSON.stringify(result).includes(claim), 'Evidence must not log the claim value');
});

test('production gate rejects missing claims before making requests and rejects false-positive HTTP 200', async () => {
  let requests = 0;
  await assert.rejects(() => runGlamaProductionCheck({ claim: '', fetcher: async () => { requests++; } }), /owner-issued GLAMA_CLAIM_TOKEN/);
  assert.equal(requests, 0);
  const badResponses = [
    new Response(null, { status: 302, headers: { location: 'https://unrelated.example/' } }),
    new Response('challenge page', { headers: { 'content-type': 'text/html' } }),
    new Response('{', { headers: { 'content-type': 'application/json' } }),
    Response.json({ $schema: GLAMA_SCHEMA, claim: 'GLAMA_ACTUAL_CLAIM_TOKEN' }),
    Response.json({ $schema: GLAMA_SCHEMA, claim: 'glama_claim_' + 'U'.repeat(32) }),
    Response.json(proof, { headers: { 'x-xguard-worker-version-tag': 'wrong' } }),
  ];
  for (const response of badResponses) {
    try {
      await runGlamaProductionCheck({ claim, expectedTag: 'git-test', fetcher: async () => response.clone() });
      assert.fail('Invalid ownership proof was accepted');
    } catch (error) {
      assert.ok(!String(error).includes(claim), 'A rejected response must not reveal the owner claim in logs');
      assert.ok(!String(error).includes('Invalid ownership proof was accepted'));
    }
  }
});
