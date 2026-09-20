import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
import { VERSION, SERVER_NAME, API } from '../apps/relay/src/core/identity.js';
import { readFile } from 'node:fs/promises';

// No provider credential, operator key, wallet, or payment is used by this probe.
export async function verifyExecution({ fetch: transport = globalThis.fetch, api = API, rounds = 3 } = {}) {
  const expected = JSON.parse(await readFile(new URL('./expected-mcp-tools.json', import.meta.url))).sort();
  const latencies = [], checks = [], started = new Date().toISOString();
  let workerVersion;
  async function call(path, body, status = 200) {
    const before = performance.now();
    const response = await transport(`${api}${path}`, { method: body === undefined ? 'GET' : 'POST', redirect: 'manual',
      headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'x-xguard-traffic-class': 'synthetic', 'user-agent': `XGuard-Execution-Monitor/${VERSION}`, 'cache-control': 'no-cache' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(12000) });
    assert.equal(response.status, status, `${path}: unexpected HTTP status`);
    assert.equal(response.headers.get('x-xguard-version'), VERSION, 'unexpected deployed product version');
    const tag = response.headers.get('x-xguard-worker-version-tag');
    if (workerVersion && tag) assert.equal(tag, workerVersion, 'release changed during verification');
    workerVersion ||= tag;
    latencies.push({ path, latency_ms: Math.round(performance.now() - before) });
    return response.json();
  }
  let id = 0;
  const rpc = async (method, params = {}) => { const message = await call('/mcp', { jsonrpc: '2.0', id: ++id, method, params }); assert.equal(message.id, id); assert.ok(!message.error); return message.result; };
  for (let i = 0; i < rounds; i++) {
    const init = await rpc('initialize', { protocolVersion: '2026-07-28', capabilities: {}, clientInfo: { name: 'xguard-execution-monitor', version: VERSION } });
    assert.equal(init.serverInfo.name, SERVER_NAME); assert.equal(init.serverInfo.version, VERSION);
    const listed = await rpc('tools/list'); assert.deepEqual(listed.tools.map(x => x.name).sort(), expected);
    const preview = await rpc('tools/call', { name: 'xguard_execute', arguments: { intent: 'demo' } });
    assert.equal(preview.isError, false); assert.equal(preview.structuredContent.cost.amount_atomic, '0');
    assert.equal(preview.structuredContent.result.network_calls, 0); checks.push('initialize/list/free_call');
  }
  const grant = await call('/v1/demo/secretless', {}, 201);
  const request = { capability: grant.capability, target: grant.target, method: 'GET', idempotency_key: grant.idempotency_key };
  const result = await call('/v1/secretless/call', request);
  assert.equal(result.result.authenticated, true); assert.equal(result.result.secret_returned, false); assert.equal(result.receipt.billed_credits, 0);
  await call('/v1/secretless/call', { ...request, method: 'DELETE' }, 403);
  const replay = await call('/v1/secretless/call', request); assert.equal(replay.request_id, result.request_id); assert.equal(replay.receipt.replay, true);
  const verified = await call('/v1/receipts/verify', { proof: result.proof, result_sha256: result.receipt.result_sha256 });
  assert.equal(verified.valid, true); assert.equal(verified.payload.demo, true); assert.equal(verified.payload.revenue, false);
  checks.push('authenticated_demo', 'scope_denied', 'durable_replay', 'proof_verified');
  await call('/v1/agent-token-usage/summary', {}, 401); checks.push('usage_authentication');
  const values = latencies.map(x => x.latency_ms).sort((a,b) => a-b);
  return { ok: true, observed_at: started, version: VERSION, worker_version_tag: workerVersion || null, checks,
    sample_size: values.length, p50_ms: values[Math.ceil(values.length * .5)-1], p95_ms: values[Math.ceil(values.length * .95)-1],
    measurements: latencies, traffic_class: 'synthetic', real_payment_performed: false, external_provider_contacted: false };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { console.log(JSON.stringify(await verifyExecution(), null, 2)); }
  catch (error) { console.error(JSON.stringify({ ok: false, version: VERSION, error: error.message, real_payment_performed: false })); process.exitCode = 1; }
}
