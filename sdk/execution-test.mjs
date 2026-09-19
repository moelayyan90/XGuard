import test from 'node:test';
import assert from 'node:assert/strict';
import { createExecutionClient } from './execution.js';
const capability = `xgc_${'a'.repeat(32)}.${'b'.repeat(43)}`;
const request = { operation: 'github.issue.create', input: { owner: 'a', repo: 'b', title: 'issue' }, idempotencyKey: 'issue-000001' };

test('execution client sends only the scoped request and never automatically retries an uncertain write', async () => {
  let count = 0;
  const client = createExecutionClient({ capability, fetch: async (url, init) => {
    count++; assert.equal(url.href, 'https://api.xguardgate.com/v1/secretless/call');
    assert.equal(init.redirect, 'manual'); assert.deepEqual(JSON.parse(init.body), { capability, operation: request.operation, input: request.input, idempotency_key: request.idempotencyKey });
    throw new Error('connection lost after write');
  } });
  await assert.rejects(client.execute(request), { code: 'delivery_uncertain', mayHaveExecuted: true });
  assert.equal(count, 1); assert.throws(() => client.execute({ ...request, idempotencyKey: undefined }));
});

test('execution client refuses redirects and malformed results without forwarding or repeating the request', async () => {
  for (const [response, code] of [[new Response(null, { status: 307, headers: { location: 'https://other.example' } }), 'redirect_refused'], [new Response('bad JSON'), 'invalid_response']]) {
    let count = 0;
    const client = createExecutionClient({ capability, fetch: async () => { count++; return response; } });
    await assert.rejects(client.execute(request), { code }); assert.equal(count, 1);
  }
  assert.throws(() => createExecutionClient({ capability, api: 'http://insecure.example' }));
  assert.throws(() => createExecutionClient({ capability: 'operator-key' }));
});

test('preflight and proof verification use their separate contracts', async () => {
  const observed = [];
  const client = createExecutionClient({ capability, fetch: async (url, init) => { observed.push([url.pathname, JSON.parse(init.body)]); return Response.json({ ok: true, valid: true }); } });
  await client.preflight(request); await client.verify({ proof: 'signed-proof', resultSha256: 'c'.repeat(64) });
  assert.equal(observed[0][0], '/v1/preflight'); assert.equal(observed[0][1].capability, capability);
  assert.equal(observed[1][0], '/v1/receipts/verify'); assert.equal(observed[1][1].capability, undefined);
});
