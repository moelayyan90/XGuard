import assert from 'node:assert/strict';
import { OPERATIONS } from '../src/network/catalog.ts';
import { LIVE_PAID } from '../src/live/paid-data.ts';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { Client, StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Client as LegacyClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport as LegacyTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const origin = 'https://xguardgate.com';
const endpoint = origin + '/mcp';
const version = '2026-07-28';
const legacy = '2025-11-25';
const payee = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const txHash = '0x' + 'a'.repeat(64);
const blockHash = '0x' + 'b'.repeat(64);
const bundle = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
const types = { TransferWithAuthorization: ['from:address', 'to:address', 'value:uint256',
  'validAfter:uint256', 'validBefore:uint256', 'nonce:bytes32'].map(item => {
  const [name, type] = item.split(':'); return { name, type };
}) };
const event = [
  parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'),
  parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)'),
];
const counts = { verify: 0, settle: 0, receipt: 0, upstream: 0 };
let authorization, omitTransfer = false, matchingReceipt = false;
const versions = [];
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{
  name: 'live-mcp', modules: true, modulesRoot: dirname(bundle), scriptPath: bundle,
  compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: {
    PROOF_AUTHORITY: { className: 'ProofAuthority', useSQLite: true },
    PAID_GATEWAY: { className: 'PaidGatewayState', useSQLite: true },
  },
  bindings: {
    LIVE_BOOTSTRAP: 'off', XGUARD_PAYMENT_ENVIRONMENT: 'production',
    XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_TREASURY_USDC_ADDRESS: payee,
    XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100', XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0',
    XGUARD_MIN_CONTRIBUTION_BPS: '2000', BASE_RPC_URL: 'https://chain.test',
  },
  outboundService: async request => {
    const url = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) {
      return MFResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    }
    if (url.hostname === 'facilitator.test') {
      if (url.pathname === '/supported') return MFResponse.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
      const { paymentPayload, paymentRequirements } = await request.json();
      const a = paymentPayload.payload.authorization;
      if (url.pathname === '/verify') {
        counts.verify++;
        const valid = await verifyTypedData({ address: a.from, types, primaryType: 'TransferWithAuthorization',
          domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: paymentRequirements.asset },
          message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) },
          signature: paymentPayload.payload.signature }).catch(() => false);
        return MFResponse.json({ isValid: valid, payer: a.from, ...(valid ? {} : { invalidReason: 'invalid_signature' }) });
      }
      assert.equal(url.pathname, '/settle');
      authorization = a; matchingReceipt = false; counts.settle++;
      return MFResponse.json({ success: true, network: 'eip155:8453', transaction: txHash, payer: a.from });
    }
    if (url.hostname === 'chain.test') {
      const { id, method, params } = await request.json();
      if (method === 'eth_chainId') return MFResponse.json({ jsonrpc: '2.0', id, result: '0x2105' });
      assert.equal(method, 'eth_getTransactionReceipt');
      assert.equal(params[0], txHash);
      assert.ok(authorization);
      counts.receipt++;
      const common = { address: usdc, blockHash, blockNumber: '0x1000', transactionHash: txHash,
        transactionIndex: '0x0', removed: false };
      const logs = [{ ...common, logIndex: '0x0', data: '0x', topics: encodeEventTopics({ abi: event,
        eventName: 'AuthorizationUsed', args: { authorizer: authorization.from, nonce: authorization.nonce } }) }];
      if (!omitTransfer) {
        logs.push({ ...common, logIndex: '0x1', data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(authorization.value)]),
          topics: encodeEventTopics({ abi: event, eventName: 'Transfer', args: { from: authorization.from, to: payee } }) });
        matchingReceipt = true;
      }
      return MFResponse.json({ jsonrpc: '2.0', id, result: { blockHash, blockNumber: '0x1000', cumulativeGasUsed: '0x5208',
        effectiveGasPrice: '0x1', from: authorization.from, gasUsed: '0x5208', logs, logsBloom: '0x' + '0'.repeat(512),
        status: '0x1', to: usdc, transactionHash: txHash, transactionIndex: '0x0', type: '0x2' } });
    }
    if (url.hostname === 'source.example.org') {
      assert.equal(matchingReceipt, true, 'Paid source contacted before the matching USDC receipt');
      counts.upstream++;
      return new MFResponse('paid-source-fixture', { headers: { 'content-type': 'text/plain', 'cache-control': 'no-store' } });
    }
    throw new Error('Network prohibited in this fixture');
  },
}] }));
const dispatch = (url, init) => mf.dispatchFetch(url instanceof Request ? url.url : String(url), init);
const trackedFetch = async (url, init) => {
  const response = await dispatch(url, init);
  assert.match(response.headers.get('strict-transport-security') ?? '', /max-age=31536000/);
  versions.push({ type: response.headers.get('content-type'), status: response.status, session: response.headers.get('mcp-session-id') });
  return response;
};
const common = { 'content-type': 'application/json', accept: 'application/json, text/event-stream',
  'mcp-protocol-version': version, 'x-xguard-traffic-class': 'synthetic' };
const meta = { 'io.modelcontextprotocol/protocolVersion': version, 'io.modelcontextprotocol/clientCapabilities': {} };
const rpc = (method, params = {}, headers = {}, id = 7) => dispatch(endpoint, { method: 'POST',
  headers: { ...common, 'mcp-method': method, ...(params.name ? { 'mcp-name': params.name } : {}), ...headers },
  body: JSON.stringify({ jsonrpc: '2.0', id, method, params: { ...params, _meta: meta } }),
});
const paid = args => ({ name: 'xguard.web.fetch', arguments: args });
const offerFor = async args => {
  const response = await rpc('tools/call', paid(args));
  assert.equal(response.status, 402, await response.clone().text());
  const requirement = decodePaymentRequiredHeader(response.headers.get('payment-required'));
  assert.equal(requirement.resource.url, endpoint);
  assert.equal(requirement.x402Version, 2);
  assert.equal(requirement.accepts[0].network, 'eip155:8453');
  assert.equal(requirement.accepts[0].amount, '1000');
  assert.equal(requirement.accepts[0].asset.toLowerCase(), usdc);
  assert.equal(requirement.accepts[0].payTo.toLowerCase(), payee);
  assert.equal((await response.json()).error.message, 'Payment required');
  return { requirement, quote: response.headers.get('x-xguard-quote') };
};
const client = new Client({ name: 'xguard-workerd-sdk', version: '1.0.0' }, { versionNegotiation: { mode: 'auto' } });
const old = new LegacyClient({ name: 'xguard-workerd-sdk-legacy', version: '1.0.0' });
try {
  await mf.ready;
  await client.connect(new StreamableHTTPClientTransport(new URL(endpoint), { fetch: trackedFetch }));
  assert.equal(client.getServerVersion()?.name, 'xguard-live');
  assert.equal(client.getNegotiatedProtocolVersion(), version);
  assert.equal((await client.listTools()).tools.length, 8 + OPERATIONS.length + Number(LIVE_PAID.some(d => d.route === 'extract')));
  for (const name of ['catalog', 'command', 'verify_receipt']) assert.ok((await client.listTools()).tools.some(t => t.name === 'xguard.authority.' + name));
  const authority = await client.callTool({ name: 'xguard.authority.catalog' });
  assert.equal(authority.structuredContent.status, 'sandbox_operator_enrollment');
  assert.equal(authority.structuredContent.pricing.live_billing, 'not_activated');
  const caps = await client.callTool({ name: 'xguard.capabilities' });
  assert.equal(caps.structuredContent.endpoint, endpoint);
  assert.ok(versions.every(r => r.session === null));
  assert.ok(versions.some(r => r.type?.startsWith('application/json') && r.status === 200));
  await old.connect(new LegacyTransport(new URL(endpoint), { fetch: trackedFetch }));
  assert.equal(old.getServerVersion()?.name, 'xguard-live');
  assert.equal((await old.listTools()).tools.length, 8 + OPERATIONS.length + Number(LIVE_PAID.some(d => d.route === 'extract')));
  assert.ok(versions.some(r => r.type?.startsWith('text/event-stream') && r.status === 200));
  const negotiation = await dispatch(endpoint, { method: 'POST', headers: { ...common, 'mcp-protocol-version': legacy },
    body: JSON.stringify({ jsonrpc: '2.0', id: 10, method: 'initialize',
      params: { protocolVersion: legacy, capabilities: {}, clientInfo: { name: 'legacy', version: '1' } } }) });
  assert.equal(negotiation.status, 200);
  assert.match(await negotiation.text(), /"protocolVersion":"2025-11-25"/);
  const recoveredDiscovery = await dispatch(endpoint, { method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 12, method: 'server/discover' }) });
  assert.equal(recoveredDiscovery.status, 200, await recoveredDiscovery.clone().text());
  assert.ok((await recoveredDiscovery.json()).result.supportedVersions.includes(version));
  const recoveredTools = await dispatch(endpoint, { method: 'POST',
    headers: { accept: 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 13, method: 'tools/list' }) });
  assert.equal(recoveredTools.status, 200, await recoveredTools.clone().text());
  assert.equal((await recoveredTools.json()).result.tools.length, 8 + OPERATIONS.length + Number(LIVE_PAID.some(d => d.route === 'extract')));
  const recoveredCaps = await dispatch(endpoint, { method: 'POST',
    headers: { 'content-type': 'application/json', 'mcp-protocol-version': version },
    body: JSON.stringify({ jsonrpc: '2.0', id: 14, method: 'tools/call', params: { name: 'xguard.capabilities' } }) });
  assert.equal(recoveredCaps.status, 200, await recoveredCaps.clone().text());
  assert.equal((await recoveredCaps.json()).result.structuredContent.endpoint, endpoint);
  const badPaidTransport = await dispatch(endpoint, { method: 'POST',
    body: JSON.stringify({ jsonrpc: '2.0', id: 15, method: 'tools/call', params: paid({ url: 'https://source.example.org/item' }) }) });
  assert.equal(badPaidTransport.status, 415);
  const apiCard = await dispatch('https://api.xguardgate.com/mcp');
  assert.equal(apiCard.status, 200);
  assert.equal((await apiCard.json()).remotes[0].url, endpoint);
  const cardHead = await dispatch(endpoint, { method: 'HEAD' });
  assert.equal(cardHead.status, 200);
  assert.equal(await cardHead.text(), '');
  const unsupportedStream = await dispatch(endpoint, { headers: { accept: 'text/event-stream' } });
  assert.equal(unsupportedStream.status, 405);
  assert.match((await unsupportedStream.json()).error.data.server_card, /\/mcp\/server-card$/);
  const discover = await rpc('server/discover');
  assert.equal(discover.status, 200, await discover.clone().text());
  assert.ok((await discover.json()).result.supportedVersions.includes(version));
  assert.equal((await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'bad', version: '1' } })).status, 404);
  const mismatch = await rpc('tools/call', paid({ url: 'https://source.example.org/item' }), { 'mcp-name': 'xguard.capabilities' });
  assert.equal(mismatch.status, 400);
  assert.equal((await mismatch.json()).error.code, -32020);
  const methodMismatch = await rpc('tools/list', {}, { 'mcp-method': 'tools/call' });
  assert.equal(methodMismatch.status, 400);
  assert.equal((await methodMismatch.json()).error.code, -32020);
  const malformed = await dispatch(endpoint, { method: 'POST', headers: common, body: '{' });
  assert.equal(malformed.status, 400);
  assert.equal((await malformed.json()).error.code, -32700);
  assert.equal((await rpc('tools/list', {}, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await dispatch(endpoint, { method: 'POST', headers: common, body: ' '.repeat(33 * 1024) })).status, 413);
  const args = { url: 'https://source.example.org/item' };
  const first = await offerFor(args);
  const legacyUnpaid = await dispatch(endpoint, { method: 'POST', headers: { ...common, 'mcp-protocol-version': legacy },
    body: JSON.stringify({ jsonrpc: '2.0', id: 11, method: 'tools/call', params: paid(args) }) });
  assert.equal(legacyUnpaid.status, 402);
  assert.equal((await legacyUnpaid.json()).id, 11);
  const invalid = await rpc('tools/call', paid(args), { 'x-xguard-quote': first.quote, 'payment-signature': 'invalid' });
  assert.equal(invalid.status, 400);
  assert.deepEqual(counts, { verify: 0, settle: 0, receipt: 0, upstream: 0 });

  // Only an unfunded ephemeral test signer and in-process provider/RPC fixtures.
  const buyer = new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
  const sign = async (offer, payload) => ({
    'x-xguard-quote': offer.quote,
    'payment-signature': encodePaymentSignatureHeader(payload || await buyer.createPaymentPayload(offer.requirement)),
  });
  const firstPayload = await buyer.createPaymentPayload(first.requirement);
  const firstProof = await sign(first, firstPayload);
  const replies = await Promise.all([rpc('tools/call', paid(args), firstProof), rpc('tools/call', paid(args), firstProof)]);
  assert.ok(replies.every(r => [200, 409].includes(r.status)), JSON.stringify(await Promise.all(replies.map(r => r.clone().text()))));
  const success = replies.find(r => r.status === 200);
  assert.ok(success?.headers.has('payment-response'));
  assert.ok((await success.json()).result.structuredContent.receipt.signature);
  assert.deepEqual(counts, { verify: 1, settle: 1, receipt: 1, upstream: 1 });
  const exact = await rpc('tools/call', paid(args), firstProof);
  assert.equal(exact.status, 200);
  assert.equal((await exact.json()).result.structuredContent.replay, true);
  assert.equal((await rpc('tools/call', paid({ url: 'https://source.example.org/altered' }), firstProof)).status, 400);
  const second = await offerFor(args);
  const nonceReuse = await rpc('tools/call', paid(args), await sign(second, { ...firstPayload, accepted: second.requirement.accepts[0], extensions: second.requirement.extensions }));
  assert.equal(nonceReuse.status, 409, await nonceReuse.clone().text());
  assert.deepEqual(counts, { verify: 1, settle: 1, receipt: 1, upstream: 1 });

  const other = { url: 'https://source.example.org/other' };
  const otherProof = await sign(await offerFor(other));
  omitTransfer = true;
  const pending = await rpc('tools/call', paid(other), otherProof);
  assert.equal(pending.status, 503, await pending.clone().text());
  assert.equal((await pending.json()).error.data.code, 'settlement_evidence_pending');
  assert.equal((await rpc('tools/call', paid(other), otherProof)).status, 503);
  assert.deepEqual(counts, { verify: 2, settle: 2, receipt: 2, upstream: 1 });
  console.log(JSON.stringify({ mcp2026: 'discover/list/call', mcp2025: 'initialize/list/SSE', malformed: 400,
    headers: 400, origin: 403, size: 413, unpaid: 402, invalid_proof: 400, exact_replay: 'cached',
    altered_replay: 400, missing_transfer: 503, fixture_settlements: counts.settle, paid_executions: counts.upstream, real_transfers: 0 }));
} finally {
  await Promise.allSettled([client.close(), old.close()]);
  await mf.dispose();
}
