import test from 'node:test';
import assert from 'node:assert/strict';
import { createXGuardAgentClient } from './index.js';

test('raw SDK authorizes the exact payload and carries the ticket without redirects', async () => {
  const calls = [];
  const agent = createXGuardAgentClient('fixture-capability', { fetchImpl: async (url, init) => {
    calls.push([new URL(url).pathname, JSON.parse(init.body)]);
    assert.equal(init.redirect, 'manual');
    return Response.json(url.endsWith('/authorize') ? { authorization: 'fixture-ticket' } : { accepted: true });
  } });
  const target = 'https://api.github.com/repos/acme/service/issues';
  const request = { method: 'POST', idempotencyKey: 'raw-issue-001', json: { title: 'مهمة مأذونة' } };
  const approval = await agent.authorize(target, request);
  assert.equal(calls.length, 1); // The handshake cannot dispatch the provider job.
  await agent.fetch(target, { ...request, governanceAuthorization: approval.authorization });
  assert.equal(calls[0][0], '/v1/egress/authorize');
  assert.equal(calls[1][0], '/v1/egress/fetch');
  assert.deepEqual(calls[1][1], { ...calls[0][1], governance_authorization: 'fixture-ticket' });
});

test('raw SDK refuses missing business keys and never retries a failed handshake', async () => {
  let calls = 0;
  const agent = createXGuardAgentClient('fixture-capability', { fetchImpl: async () => {
    calls++; throw new Error('connection refused');
  } });
  await assert.rejects(agent.authorize('https://example.com/data'), /idempotencyKey/);
  assert.equal(calls, 0);
  await assert.rejects(agent.authorize('https://example.com/data', { idempotencyKey: 'read-data-001' }), /connection refused/);
  assert.equal(calls, 1);
});
