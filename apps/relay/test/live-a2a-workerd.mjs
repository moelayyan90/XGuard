import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { checkA2a, origin } from './live-a2a-smoke.mjs';
import { shardName, shardOf } from '../src/live/util.ts';

const bundle = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
let sourceCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{
  name: 'xguard-live-a2a', modules: true, modulesRoot: dirname(bundle), scriptPath: bundle,
  compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    LIVE_SHARDS: { className: 'LiveShard', useSQLite: true },
    LIVE_CONTROL: { className: 'LiveControl', useSQLite: true },
  },
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'on', MONETIZATION_MODE: 'observe', CF_VERSION_METADATA: { id: 'fixture-version' } },
  outboundService: async request => {
    const u = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(u.hostname)) {
      return MFResponse.json({ Status: 0, Answer: u.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    }
    if (u.hostname === 'registry.npmjs.org' && u.pathname === '/robots.txt') return new MFResponse('', { status: 404 });
    if (u.hostname === 'registry.npmjs.org' && u.pathname === '/react/latest') {
      sourceCalls++; return MFResponse.json({ name: 'react', version: '1.2.3', license: 'MIT' });
    }
    throw new Error('Unexpected external call');
  },
}] }));
try {
  await mf.ready;
  const entity = 'npm/react', factId = entity + '/latest-version';
  const ns = await mf.getDurableObjectNamespace('LIVE_SHARDS'), stub = ns.get(ns.idFromName(shardName(shardOf(entity))));
  const rpc = (op, body = {}) => stub.fetch('https://internal/rpc', { method: 'POST', body: JSON.stringify({ op, ...body }) }).then(r => r.json());
  await rpc('seed', { sources: [{ adapter: 'npm', identifier: 'react' }] });
  for (let i = 0; i < 80; i++) {
    if ((await rpc('fact', { id: factId }))?.current_value === '1.2.3') break;
    await new Promise(r => setTimeout(r, 250));
  }
  assert.equal((await rpc('fact', { id: factId })).current_value, '1.2.3');
  const count = sourceCalls;
  const fetcher = (url, init) => mf.dispatchFetch(url instanceof Request ? url.url : String(url), init);
  console.log(JSON.stringify(await checkA2a(fetcher)));
  assert.equal(sourceCalls, count, 'A2A reads must not initiate source collection or paid execution');

  const alias = await fetcher('https://api.xguardgate.com/.well-known/agent-card.json');
  assert.equal(alias.status, 200);
  assert.equal((await alias.json()).supportedInterfaces[0].url, origin + '/a2a');
  const nestedCard = await fetcher(origin + '/a2a/.well-known/agent-card.json');
  assert.equal(nestedCard.status, 200);
  assert.equal((await nestedCard.json()).supportedInterfaces[0].url, origin + '/a2a');

  const install = await fetcher(origin + '/install', { headers: { accept: 'text/html' } });
  assert.equal(install.status, 200);
  assert.equal(install.headers.get('x-xguard-worker-version-id'), 'fixture-version');
  const installHtml = await install.text();
  assert.match(installHtml, /vscode:mcp\/install\?/);
  assert.match(installHtml, /cursor:\/\/anysphere\.cursor-deeplink/);
  assert.match(installHtml, /xguard\.fact\.get/);
  for (const path of ['/server.json', '/mcp/server-card']) {
    const response = await fetcher(origin + path);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('x-xguard-worker-version-id'), 'fixture-version');
    assert.equal((await response.json()).remotes[0].url, origin + '/mcp');
  }
  for (const path of ['/connect', '/developers']) {
    const response = await fetcher(origin + path, { redirect: 'manual' });
    assert.equal(response.status, 308);
    assert.equal(response.headers.get('location'), origin + '/install');
  }
  const mcpCard = await fetcher(origin + '/mcp');
  assert.equal(mcpCard.status, 200);
  assert.equal((await mcpCard.json()).remotes[0].url, origin + '/mcp');

  const client = new Client({ name: 'xguard-install-fixture', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(new URL(origin + '/mcp'), { fetch: fetcher }));
  try {
    const tools = await client.listTools();
    assert.equal(tools.tools.find(tool => tool.name === 'xguard.fact.get').annotations.readOnlyHint, true);
    const valid = await client.callTool({ name: 'xguard.fact.get', arguments: { factId } });
    assert.equal(valid.structuredContent.fact.current_value, '1.2.3');
    assert.equal(valid.structuredContent.fact.source_url, 'https://registry.npmjs.org/react/latest');
    assert.equal(valid.structuredContent.canonicalUrl, origin + '/fact/' + factId);
    for (const args of [{ factId: '../admin/secret' }, { factId, url: 'https://example.com' }]) {
      assert.equal((await client.callTool({ name: 'xguard.fact.get', arguments: args })).isError, true);
    }
  } finally { await client.close(); }
  const headers = { 'content-type': 'application/json', 'a2a-version': '1.0' };
  const send = (data, extra = {}) => fetcher(origin + '/a2a', { method: 'POST', headers: { ...headers, ...extra }, body: JSON.stringify({
    jsonrpc: '2.0', id: 1, method: 'SendMessage',
    params: { message: { messageId: 'fixture', role: 'ROLE_USER', parts: [{ data }] } },
  }) });
  const ssrf = await send({ action: 'xguard.fact.get', factId: '../../api/paid/v1/batch' });
  assert.equal((await ssrf.json()).error.code, -32602);
  const proof = await send({ action: 'xguard.fact.get', factId }, { 'payment-signature': 'fixture-not-a-payment' });
  assert.equal((await proof.json()).error.code, -32004);
  assert.equal((await fetcher(origin + '/a2a', { method: 'POST', headers, body: '{' })).status, 400);
  assert.equal((await fetcher(origin + '/a2a', { method: 'POST', headers, body: ' '.repeat(17000) })).status, 413);
  assert.equal((await fetcher(origin + '/.well-known/unknown-agent', { headers })).status, 410);
  assert.equal(sourceCalls, count);
} finally { await mf.dispose(); }
