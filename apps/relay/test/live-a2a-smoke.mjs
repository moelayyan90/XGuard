import assert from 'node:assert/strict';
import { OPERATIONS } from '../src/network/catalog.ts';
import { pathToFileURL } from 'node:url';
import { AgentCard, Message } from '@a2a-js/sdk';
import { ClientFactory, ClientFactoryOptions, DefaultAgentCardResolver, JsonRpcTransportFactory } from '@a2a-js/sdk/client';

export const origin = 'https://xguardgate.com';
const cardPath = '/.well-known/agent-card.json';
const factId = 'npm/react/latest-version';
const dataPart = message => message.parts?.find(part => part.content?.$case === 'data')?.content.value;
const message = part => Message.fromJSON({ messageId: crypto.randomUUID(), role: 'ROLE_USER', parts: [part] });

export async function checkA2a(fetcher) {
  const cardResponse = await fetcher(origin + cardPath);
  assert.equal(cardResponse.status, 200);
  assert.match(cardResponse.headers.get('content-type'), /^application\/json\b/);
  assert.equal(cardResponse.headers.has('payment-required'), false);
  const cardWire = await cardResponse.json();
  // Decode and validate against the official v1.0 protocol's generated
  // AgentCard definition, then let the SDK resolve and select the interface.
  const card = AgentCard.fromJSON(cardWire);
  assert.deepEqual(cardWire, JSON.parse(JSON.stringify(card)));
  assert.ok(card.name && card.description && card.version);
  assert.equal(card.capabilities?.streaming, false);
  assert.equal(card.capabilities?.pushNotifications, false);
  assert.equal(card.capabilities?.extendedAgentCard, false);
  assert.deepEqual(card.securityRequirements, []);
  assert.deepEqual(card.securitySchemes, {});
  assert.deepEqual(card.supportedInterfaces.map(({ url, protocolBinding, protocolVersion }) => ({ url, protocolBinding, protocolVersion })),
    [{ url: origin + '/a2a', protocolBinding: 'JSONRPC', protocolVersion: '1.0' }]);
  assert.deepEqual(card.skills.map(s => s.id), ['xguard.authority', 'xguard.discover', 'xguard.fact.get', ...OPERATIONS.map(d => 'xguard.network.' + d.route.replaceAll('-', '_'))]);
  assert.ok(card.skills.every(s => s.name && s.description && s.tags.length > 0));
  const authorityResponse = await fetcher(origin + '/v1/authority/catalog', { headers: { accept: 'application/json' } });
  assert.equal(authorityResponse.status, 200);
  const authority = await authorityResponse.json();
  assert.equal(authority.status, 'sandbox_operator_enrollment');
  assert.equal(authority.pricing.live_billing, 'not_activated');
  assert.equal(authority.pricing.sandbox_charge, '0');

  const factory = new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default, {
    cardResolver: new DefaultAgentCardResolver({ fetchImpl: fetcher }),
    transports: [new JsonRpcTransportFactory({ fetchImpl: fetcher })],
    preferredTransports: ['JSONRPC'],
  }));
  const client = await factory.createFromUrl(origin);
  const greeting = await client.sendMessage({ message: message({ text: 'Hello' }) });
  assert.equal(Message.toJSON(greeting).role, 'ROLE_AGENT');
  assert.ok(greeting.contextId);
  assert.equal(dataPart(greeting)?.agent, 'XGuard Live');
  const result = await client.sendMessage({ message: message({ data: { action: 'xguard.fact.get', factId } }) });
  const data = dataPart(result);
  assert.equal(data?.fact?.id, factId);
  assert.ok(data.fact.source_hash && data.fact.verified_at);
  assert.equal(data.canonicalUrl, origin + '/fact/' + factId);
  await assert.rejects(() => client.sendMessage({ message: message({ data: {
    action: 'xguard.web.fetch', input: { url: 'https://example.com/' },
  } }) }), /Action not available on the public A2A interface/);
  return {
    workerId: cardResponse.headers.get('x-xguard-worker-version-id'),
    workerTag: cardResponse.headers.get('x-xguard-worker-version-tag'),
    cardHttp: cardResponse.status, protocol: card.supportedInterfaces[0].protocolVersion,
    greeting: 'ROLE_AGENT Message', fact: data.fact.id, paidAction: 'rejected',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = await checkA2a((input, init = {}) => {
    const headers = new Headers(init.headers ?? (input instanceof Request ? input.headers : undefined));
    headers.set('user-agent', 'XGuardA2ASmoke/1.0');
    if (process.env.CANDIDATE_WORKER_ID) {
      headers.set('cloudflare-workers-version-overrides', 'xguard-mainnet="' + process.env.CANDIDATE_WORKER_ID + '"');
    }
    return fetch(input, { ...init, headers, redirect: 'error',
      signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(15000)]) : AbortSignal.timeout(15000) });
  });
  if (process.env.CANDIDATE_WORKER_ID) assert.equal(result.workerId, process.env.CANDIDATE_WORKER_ID);
  if (process.env.EXPECTED_XGUARD_TAG) assert.equal(result.workerTag, process.env.EXPECTED_XGUARD_TAG);
  console.log(JSON.stringify(result));
}
