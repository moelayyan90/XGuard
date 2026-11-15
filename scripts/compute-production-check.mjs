// Read-only production verification. This script never signs, pays or launches
// upstream compute. A successful probe is not a real economic canary.
import assert from 'node:assert/strict';
const base = 'https://api.xguardgate.com';
const evidence = { checked_at: new Date().toISOString(), production_payment_attempted: false, real_canary: 'NOT_RUN', results: {} };
for (const path of ['/v1/compute/providers', '/v1/compute/health', '/v1/compute/models', '/openapi.json', '/.well-known/agent-card.json']) {
  const r = await fetch(base + path, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
  const data = await r.json();
  if (path === '/v1/compute/health') {
    assert.ok([200, 503].includes(r.status)); assert.equal(data.service, 'XGuard Compute');
    evidence.ready_for_compute = data.ready; evidence.providers = data.providers;
  } else assert.equal(r.status, 200, path);
  if (path === '/openapi.json') assert.ok(data.paths['/v1/inference/execute'] && data.paths['/v1/gpu/execute']);
  if (path === '/.well-known/agent-card.json') assert.ok(data.skills.some(s => s.id === 'xguard.compute.execute_inference'));
  evidence.results[path] = { status: r.status };
}
const mcp = await fetch('https://xguardgate.com/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', 'mcp-protocol-version': '2026-07-28', 'mcp-method': 'tools/list' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: { _meta: { 'io.modelcontextprotocol/protocolVersion': '2026-07-28', 'io.modelcontextprotocol/clientCapabilities': {} } } }), signal: AbortSignal.timeout(15000) });
assert.equal(mcp.status, 200);
const list = await mcp.json(); assert.ok(list.result.tools.some(t => t.name === 'execute_inference'));
evidence.results.mcp_compute_tools = 'present';
console.log(JSON.stringify(evidence, null, 2));
