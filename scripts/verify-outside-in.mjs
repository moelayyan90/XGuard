import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const expected = JSON.parse(readFileSync(new URL('./expected-mcp-tools.json', import.meta.url)));
const origins = ['https://xguardgate.com', 'https://api.xguardgate.com'];
const clients = [{ name: 'external-mcp-evaluator', protocol: '2025-06-18', accept: 'application/json' }, { name: 'external-agent-runtime', protocol: '2026-07-28', accept: 'application/json, text/event-stream' }];
const rows = [];
async function rpc(origin, client, method, params) {
  const r = await fetch(`${origin}/mcp`, { method: 'POST', redirect: 'manual', headers: { 'content-type': 'application/json', accept: client.accept, 'MCP-Protocol-Version': client.protocol, 'user-agent': client.name, 'x-xguard-traffic-class': 'synthetic' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }), signal: AbortSignal.timeout(20000) });
  assert.equal(r.status, 200, `${origin} ${method}: HTTP ${r.status}`);
  const b = await r.json(); assert.ok(!b.error, JSON.stringify(b.error)); return b.result;
}
for (const origin of origins) for (const client of clients) {
  const init = await rpc(origin, client, 'initialize', { protocolVersion: client.protocol, capabilities: {}, clientInfo: { name: client.name, version: '1.0.0' } });
  const listed = await rpc(origin, client, 'tools/list', {});
  const names = listed.tools.map(x=>x.name).sort();
  rows.push({ endpoint: `${origin}/mcp`, client: client.name, requested_protocol: client.protocol, negotiated_protocol: init.protocolVersion, version: init.serverInfo.version, tools: names });
  assert.deepEqual(names, expected, `Outside-in contract mismatch at ${origin} for ${client.name}`);
}
for (const origin of origins) {
  const card = await fetch(`${origin}/.well-known/agent-card.json?audit=${Date.now()}`, { signal: AbortSignal.timeout(20000) });
  assert.equal(card.status,200);const a=await card.json();assert.ok(a.skills?.length>0);
  const api=await fetch(`${origin}/openapi.json?audit=${Date.now()}`, {signal:AbortSignal.timeout(20000)});assert.equal(api.status,200);const d=await api.json();assert.ok(d.paths['/v1/egress/fetch']);
}
const manifest=await (await fetch(`https://xguardgate.com/server.json?audit=${Date.now()}`,{signal:AbortSignal.timeout(20000)})).json();
assert.ok(manifest.remotes.some(x=>x.url==='https://api.xguardgate.com/mcp'));
console.log(JSON.stringify({ observed_at:new Date().toISOString(), source:'unauthenticated external HTTP clients on GitHub Actions', ok:true, expected_tools:expected.length, clients:rows },null,2));
