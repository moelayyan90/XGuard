import assert from 'node:assert/strict';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { decodePaymentRequiredHeader } from '@x402/core/http';

const url = new URL('https://xguardgate.com/mcp');
const version = '2026-07-28';
const headers = { 'x-xguard-traffic-class': 'synthetic', 'user-agent': 'XGuardMCPSmoke/1.0',
  ...(process.env.CANDIDATE_WORKER_ID ? { 'Cloudflare-Workers-Version-Overrides': 'xguard-mainnet="' + process.env.CANDIDATE_WORKER_ID + '"' } : {}) };
let workerId, tag;
const fetcher = async (input, init = {}) => {
  const combined = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
  for (const [name, value] of Object.entries(headers)) combined.set(name, value);
  const response = await fetch(input, { ...init, headers: combined, redirect: 'error',
    signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  workerId = response.headers.get('x-xguard-worker-version-id');
  tag = response.headers.get('x-xguard-worker-version-tag');
  if (process.env.CANDIDATE_WORKER_ID) assert.equal(workerId, process.env.CANDIDATE_WORKER_ID);
  if (process.env.EXPECTED_XGUARD_TAG) assert.equal(tag, process.env.EXPECTED_XGUARD_TAG);
  assert.equal(response.headers.has('mcp-session-id'), false);
  return response;
};
const client = new Client({ name: 'xguard-smoke', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
const old = new LegacyClient({ name: 'xguard-legacy-smoke', version: '1.0.0' });
const rpc = (method, args, extra = {}) => fetcher(url, { method: 'POST',
  headers: { accept: 'application/json, text/event-stream', 'content-type': 'application/json',
    'mcp-protocol-version': version, 'mcp-method': method, ...(args?.name ? { 'mcp-name': args.name } : {}), ...extra },
  body: JSON.stringify({ jsonrpc: '2.0', id: 7, method,
    params: { ...args, _meta: { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} } } }),
});
try {
  await client.connect(new StreamableHTTPClientTransport(url, { fetch: fetcher }));
  assert.equal(client.getNegotiatedProtocolVersion(), version);
  const list = await client.listTools();
  assert.ok(list.tools.some(tool => tool.name === 'xguard.web.fetch'));
  const free = await client.callTool({ name: 'xguard.capabilities' });
  assert.equal(free.structuredContent.endpoint, url.href);
  await old.connect(new LegacyTransport(url, { fetch: fetcher }));
  assert.equal(old.getServerVersion()?.name, 'xguard-live');
  assert.ok((await old.listTools()).tools.some(tool => tool.name === 'xguard.capabilities'));
  const args = { name: 'xguard.web.fetch', arguments: { url: 'https://example.com/' } };
  const unpaid = await rpc('tools/call', args);
  assert.equal(unpaid.status, 402, await unpaid.clone().text());
  const requirement = decodePaymentRequiredHeader(unpaid.headers.get('Payment-Required'));
  assert.equal(requirement.x402Version, 2);
  assert.equal(requirement.resource.url, url.href);
  assert.equal(requirement.accepts[0].network, 'eip155:8453');
  assert.equal(requirement.accepts[0].amount, '1000');
  assert.equal((await unpaid.json()).error.message, 'Payment required');
  const invalid = await rpc('tools/call', args, { 'X-XGuard-Quote': unpaid.headers.get('X-XGuard-Quote'), 'Payment-Signature': 'invalid' });
  assert.equal(invalid.status, 400);
  assert.equal((await invalid.json()).error.data.code, 'payment_payload_invalid');
  const mismatch = await rpc('tools/call', args, { 'mcp-name': 'xguard.capabilities' });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, -32020);
  console.log(JSON.stringify({ worker_id: workerId, worker_tag: tag, protocol: version, legacy: '2025-11-25',
    tools: list.tools.map(t => t.name), free_tool: 200, unpaid_tool: 402, invalid_proof: 400,
    mismatched_header: 400, real_transfers: 0 }));
} finally {
  await Promise.allSettled([client.close(), old.close()]);
}
