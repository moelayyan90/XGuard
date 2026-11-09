import { financialAuthorityFetch } from '../financial-authority/http.js';
import type { AgentCard } from '@a2a-js/sdk';
import { readPublicJson, parsePublicJson } from '../core/public-contract.js';
import { factExample, isPublicFactId, readPublicFact } from './public-fact.ts';
import { securityHeaders } from './security.ts';
import { ORIGIN, VERSION, type Env } from './types.ts';
import { OPERATIONS } from '../network/catalog.ts';
import { livePaidFetch } from '../live-paid-entry.js';

export const A2A_CARD_PATH = '/.well-known/agent-card.json';
export const A2A_PATH = '/a2a';
const WIRE_VERSION = '1.0';
const discoveryAction = 'xguard.discover';
const factAction = 'xguard.fact.get';
const inputModes = ['text/plain', 'application/json'];
const outputModes = ['text/plain', 'application/json'];
const maxRequestBytes = 16 * 1024;

const card: AgentCard = {
  name: 'XGuard Live',
  description: 'Discover XGuard, read legacy published facts, or purchase bounded route, discovery and durable public-read execution through x402 v2. Paid actions use an explicit spending cap and the canonical HTTP payment resource.',
  version: VERSION,
  provider: { organization: 'XGuard', url: ORIGIN },
  documentationUrl: ORIGIN + '/install',
  supportedInterfaces: [{
    url: ORIGIN + A2A_PATH, protocolBinding: 'JSONRPC', protocolVersion: WIRE_VERSION,
    tenant: '',
  }],
  capabilities: { streaming: false, pushNotifications: false, extendedAgentCard: false, extensions: [] },
  securitySchemes: {}, securityRequirements: [], signatures: [],
  defaultInputModes: inputModes, defaultOutputModes: outputModes,
  skills: [{ id: 'xguard.authority', name: 'Signed agent financial authority', description: 'Submit a signed delegation sandbox envelope over the same HTTP authority contract; no live payment or custody is implied.', tags: ['delegation', 'budgets', 'sandbox'], examples: [JSON.stringify({ action: 'xguard.authority', envelope: {} })], inputModes: ['application/json'], outputModes: ['application/json'], securityRequirements: [] }, {
    id: discoveryAction, name: 'Discover XGuard Live',
    description: 'List the supported A2A actions and the current public XGuard links.',
    tags: ['discovery', 'a2a'], examples: ['Hello', JSON.stringify({ action: discoveryAction })],
    inputModes, outputModes, securityRequirements: [],
  }, {
    id: factAction, name: 'Read a published fact',
    description: 'Read one public XGuard fact by its canonical ID, including its source and verification status.',
    tags: ['facts', 'software', 'provenance'],
    examples: [JSON.stringify({ action: factAction, factId: factExample })],
    inputModes, outputModes, securityRequirements: [],
  }, ...OPERATIONS.map(d => ({ id: 'xguard.network.' + d.route.replaceAll('-', '_'), name: d.name, description: d.description + ` Price: ${Number(d.amount)/1e6} USDC on Base; x402 HTTP payment headers required after the initial challenge.`, tags: ['paid', 'route-network'], examples: [JSON.stringify({ action: 'xguard.network.' + d.route.replaceAll('-', '_'), input: d.example, idempotency_key: 'stable-client-key' })], inputModes: ['application/json'], outputModes: ['application/json'], securityRequirements: [] }))],
};

type RpcId = string | number | null;
type JsonObject = Record<string, unknown>;
const record = (value: unknown): JsonObject | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as JsonObject : null;

function headers(env: Env, cache: string) {
  const result = new Headers(securityHeaders());
  result.set('content-type', 'application/json; charset=utf-8');
  result.set('cache-control', cache);
  result.set('access-control-allow-origin', '*');
  result.set('access-control-allow-headers', 'Content-Type, A2A-Version, A2A-Extensions, Payment-Signature, X-XGuard-Quote');
  result.set('access-control-expose-headers', 'A2A-Version, X-XGuard-Worker-Version-Id, X-XGuard-Worker-Version-Tag');
  result.set('a2a-version', WIRE_VERSION);
  result.set('x-xguard-a2a', 'public-v1');
  if (env.CF_VERSION_METADATA?.id) result.set('x-xguard-worker-version-id', env.CF_VERSION_METADATA.id);
  if (env.CF_VERSION_METADATA?.tag) result.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  return result;
}

export function liveAgentCard(request: Request, env: Env) {
  const responseHeaders = headers(env, 'public, max-age=300');
  responseHeaders.set('access-control-allow-methods', 'GET, HEAD, OPTIONS');
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders });
  return new Response(request.method === 'HEAD' ? null : JSON.stringify(card), { headers: responseHeaders });
}

function discovery() {
  return {
    agent: card.name,
    actions: card.skills.map(({ id }) => id),
    authentication: 'none',
    agentCard: ORIGIN + A2A_CARD_PATH,
    facts: ORIGIN + '/topics',
    mcp: ORIGIN + '/mcp',
    paidServices: 'https://api.xguardgate.com/api/paid/v1/catalog',
    example: { action: factAction, factId: factExample },
  };
}

function intent(part: unknown) {
  const value = record(part);
  if (!value || ['url', 'raw'].some(key => key in value) || ('data' in value && 'text' in value)) return null;
  if ('data' in value) return record(value.data);
  if (typeof value.text !== 'string' || !value.text.trim()) return null;
  if (value.text.trimStart().startsWith('{')) {
    const parsed = parsePublicJson(value.text);
    return 'value' in parsed ? record(parsed.value) : null;
  }
  // Plain messages are a discoverability probe. They never execute a
  // supplied URL, infer an action or invoke any paid operation.
  return { action: discoveryAction };
}

export async function liveA2aFetch(request: Request, env: Env, readPublishedFact: (request: Request) => Promise<Response>) {
  const responseHeaders = headers(env, 'no-store');
  responseHeaders.set('access-control-allow-methods', 'POST, OPTIONS');
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: responseHeaders });
  const error = (id: RpcId, code: number, message: string, status = 200, data?: JsonObject) =>
    json({ jsonrpc: '2.0', id, error: { code, message, ...(data ? { data } : {}) } }, status);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: responseHeaders });
  if (request.method !== 'POST') {
    responseHeaders.set('allow', 'POST, OPTIONS');
    return request.method === 'HEAD' ? new Response(null, { status: 405, headers: responseHeaders })
      : error(null, -32600, 'Use JSON-RPC POST', 405);
  }
  const contentType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase();
  if (contentType !== 'application/json' && contentType !== 'application/a2a+json') {
    return error(null, -32600, 'JSON content type required', 415);
  }
  const parsed = await readPublicJson(request, maxRequestBytes);
  if (!('value' in parsed)) return error(null, -32700, 'Invalid JSON', parsed.error === 'payload_too_large' ? 413 : 400);
  const rpc = record(parsed.value);
  const id = rpc?.id;
  if (!rpc || rpc.jsonrpc !== '2.0' || (typeof id !== 'string' && !Number.isSafeInteger(id)) ||
      typeof rpc.method !== 'string') return error(null, -32600, 'Invalid Request', 400);
  const rpcId = id as string | number;
  const queryVersion = new URL(request.url).searchParams.get('A2A-Version');
  const version = request.headers.get('a2a-version') ?? queryVersion;
  if (version !== null && ![WIRE_VERSION, '1.0.0'].includes(version)) {
    return error(rpcId, -32009, 'Version not supported', 200, { supported: [WIRE_VERSION] });
  }
  if (rpc.method !== 'SendMessage') return error(rpcId, -32004, 'Operation not supported', 200, { supported: ['SendMessage'] });
  const message = record(record(rpc.params)?.message);
  if (!message || message.role !== 'ROLE_USER' || typeof message.messageId !== 'string' ||
      !message.messageId || message.messageId.length > 128 || !Array.isArray(message.parts) ||
      message.parts.length !== 1) return error(rpcId, -32602, 'Expected one user message part');
  if (message.taskId) return error(rpcId, -32001, 'Task not found');
  const action = intent(message.parts[0]);
  if (!action) return error(rpcId, -32602, 'Unsupported message part');
  if (action.action === 'xguard.authority') {
    const envelope = record(action.envelope);
    if (!envelope || Object.keys(action).length !== 3 || typeof action.organization_token !== 'string' || typeof envelope.action !== 'string' || !/^[a-z]+$/.test(envelope.action)) return error(rpcId, -32602, 'Expected one signed envelope');
    const response = await financialAuthorityFetch(new Request('https://api.xguardgate.com/v1/authority/' + envelope.action, { method: 'POST', headers: { 'content-type': 'application/json', 'x-xguard-organization-token': action.organization_token }, body: JSON.stringify(envelope) }), env);
    if (!response) return error(rpcId, -32603, 'Authority unavailable', 503);
    const data = await response.json();
    if (!response.ok) return error(rpcId, -32000, 'Signed authority command rejected', response.status, data);
    return json({ jsonrpc: '2.0', id: rpcId, result: { message: { messageId: crypto.randomUUID(), role: 'ROLE_AGENT', parts: [{ data }] } } });
  }
  const paid = OPERATIONS.find(d => action.action === 'xguard.network.' + d.route.replaceAll('-', '_'));
  if (paid) {
    if (!record(action.input) || typeof action.idempotency_key !== 'string' || Object.keys(action).some(k => !['action', 'input', 'idempotency_key'].includes(k))) return error(rpcId, -32602, 'Expected input and idempotency_key');
    const forwarded = new Headers(request.headers); forwarded.set('content-type', 'application/json'); forwarded.set('idempotency-key', action.idempotency_key);
    const pending: Promise<any>[] = [];
    const response = await livePaidFetch(new Request('https://api.xguardgate.com/api/paid/v1/' + paid.route, { method: 'POST', headers: forwarded, body: JSON.stringify(action.input) }), env, { waitUntil: (p: Promise<any>) => pending.push(p) });
    await Promise.allSettled(pending);
    if (!response) return error(rpcId, -32603, 'Paid action unavailable', 503);
    const data = await response.json();
    for (const name of ['Payment-Required', 'Payment-Response', 'X-XGuard-Quote', 'X-XGuard-Receipt', 'X-XGuard-Proof']) { const value = response.headers.get(name); if (value) responseHeaders.set(name, value); }
    responseHeaders.set('access-control-expose-headers', 'Payment-Required, Payment-Response, X-XGuard-Quote, X-XGuard-Receipt, X-XGuard-Proof, A2A-Version');
    if (!response.ok) return error(rpcId, -32000, response.status === 402 ? 'Payment required' : 'Paid action rejected', response.status, data);
    return json({ jsonrpc: '2.0', id: rpcId, result: { message: { messageId: crypto.randomUUID(), role: 'ROLE_AGENT', contextId: message.contextId || crypto.randomUUID(), parts: [{ text: JSON.stringify(data) }, { data }] } } });
  }
  if (['payment-signature', 'x-xguard-quote', 'x-xguard-credit'].some(key => request.headers.has(key)) ||
      (action.action !== discoveryAction && action.action !== factAction)) {
    // A2A exposes only existing free reads. Do not forward payment proofs or
    // dispatch to a paid endpoint, even if an arbitrary URL was supplied.
    return error(rpcId, -32004, 'Action not available on the public A2A interface', 200,
      { actions: [discoveryAction, factAction], paidServices: discovery().paidServices });
  }

  let data: unknown;
  if (action.action === discoveryAction) data = discovery();
  else {
    const factId = action.factId;
    if (!isPublicFactId(factId) ||
        Object.keys(action).some(key => key !== 'action' && key !== 'factId')) {
      return error(rpcId, -32602, 'Expected a canonical public factId', 200, { example: factExample });
    }
    try {
      data = await readPublicFact(factId, readPublishedFact);
      if (!data) return error(rpcId, -32602, 'Published fact not found');
    } catch {
      return error(rpcId, -32603, 'Public fact temporarily unavailable', 503);
    }
  }
  return json({ jsonrpc: '2.0', id: rpcId, result: { message: {
    messageId: crypto.randomUUID(), role: 'ROLE_AGENT',
    contextId: typeof message.contextId === 'string' && message.contextId.length <= 128 && message.contextId
      ? message.contextId : crypto.randomUUID(),
    parts: [{ text: JSON.stringify(data) }, { data }],
  } } });
}
