import { financialAuthorityFetch, authorityCatalog, authorityEnvelopeSchema } from '../financial-authority/http.js';
import { createMcpHandler, Server, type ListToolsResult } from '@modelcontextprotocol/server';
import { handlePaidWebFetch, handlePreflight, issueQuote, jsonBody, mcpToolsForEnv } from '../paid-agent-entry.js';
import { logNormalization } from '../core/public-contract.js';
import { integrationLinks, mcpServerCard } from './integrations.ts';
import { factIdSchema, isPublicFactId, readPublicFact } from './public-fact.ts';
import { securityHeaders } from './security.ts';
import { ORIGIN, VERSION, type Env } from './types.ts';
import { extractEnabled } from './extract-page.ts';
import { EXTRACT_SERVICE, PAID_BASE, paidInputSchema } from './paid-data.ts';
import { livePaidFetch } from '../live-paid-entry.js';
import { OPERATIONS } from '../network/catalog.ts';

const origins = [ORIGIN, 'https://api.xguardgate.com'];
const methods = ['GET', 'HEAD', 'POST', 'OPTIONS'];
const factTool = 'xguard.fact.get';
const toolNames = new Set(['xguard.capabilities', 'xguard.preflight', 'xguard.pricing.quote', 'xguard.web.fetch', 'xguard.extract']);
for (const name of ['catalog', 'command', 'verify_receipt']) toolNames.add('xguard.authority.' + name);
for (const d of OPERATIONS) toolNames.add('xguard.' + d.route.replaceAll('-', '_'));
const paymentHeaders = ['Payment-Required', 'Payment-Response', 'X-XGuard-Quote', 'X-XGuard-Request-Id',
  'X-XGuard-Payment-Identifier', 'X-XGuard-Replay', 'X-XGuard-Receipt', 'X-XGuard-Proof', 'Retry-After'];
const maxBody = 32 * 1024;
const modernVersion = '2026-07-28';
const versionKey = 'io.modelcontextprotocol/protocolVersion';
const capabilitiesKey = 'io.modelcontextprotocol/clientCapabilities';
const publicMethods = new Set(['server/discover', 'tools/list', 'ping']);
const publicTools = new Set([factTool, 'xguard.capabilities']);
const credentialHeaders = ['authorization', 'payment-signature', 'x-payment', 'x-xguard-quote', 'x-xguard-credit'];

type RpcId = number | string | null;
type PaymentResponse = { id: RpcId; response: Response };
const rpcError = (id: RpcId, code: number, message: string, status: number, data?: unknown) =>
  Response.json({ jsonrpc: '2.0', id, error: { code, message, ...(data === undefined ? {} : { data }) } }, { status });

function rpcHeaders(response: Response, request: Request, env: Env) {
  const headers = new Headers(response.headers);
  headers.set('cache-control', 'no-store');
  headers.set('x-content-type-options', 'nosniff');
  headers.set('strict-transport-security', securityHeaders()['strict-transport-security']);
  headers.set('x-robots-tag', 'noindex');
  headers.set('vary', 'Origin, Accept');
  if (env.CF_VERSION_METADATA) {
    headers.set('x-xguard-worker-version-id', env.CF_VERSION_METADATA.id);
    if (env.CF_VERSION_METADATA.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
  }
  const origin = request.headers.get('origin');
  if (origin && origins.includes(origin)) {
    headers.set('access-control-allow-origin', origin);
    headers.set('access-control-allow-methods', methods.join(', '));
    headers.set('access-control-allow-headers', 'Accept, Content-Type, MCP-Protocol-Version, Mcp-Method, Mcp-Name, Payment-Signature, X-XGuard-Quote');
    headers.set('access-control-expose-headers', paymentHeaders.join(', '));
  }
  if (response.status === 405) headers.set('allow', methods.join(', '));
  return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
}

async function toolFailure({ response, id }: PaymentResponse) {
  const payload = await response.json().catch(() => null);
  const code = typeof payload?.error === 'string' ? payload.error : payload?.error_code;
  const isChallenge = response.status === 402 && response.headers.has('Payment-Required');
  const message = isChallenge ? 'Payment required' : response.status >= 500 ? 'Tool temporarily unavailable' : 'Tool request rejected';
  const result = rpcError(id, response.status === 400 || response.status === 422 ? -32602 : -32000,
    message, response.status, isChallenge ? payload : {
      code: typeof code === 'string' && /^[a-z0-9_]{1,100}$/.test(code) ? code : 'tool_request_failed',
      retry_same_request: response.status >= 500 || response.status === 409,
      ...(response.status >= 500 || response.status === 409 ? { new_payment_required: false } : {}),
    });
  for (const name of paymentHeaders) {
    const value = response.headers.get(name);
    if (value) result.headers.set(name, value);
  }
  return result;
}

function list(env: Env): ListToolsResult {
  const existingTools = mcpToolsForEnv(env).map(tool => {
    // The HTTP payment transport is deliberately distinct from x402's in-band
    // MCP extension. An agent retries this same POST with the returned headers.
    if (tool.name === 'xguard.web.fetch') tool.description =
      'Fetch one public HTTPS resource after x402 v2 payment and on-chain settlement verification. Retry the identical MCP call with Payment-Signature and X-XGuard-Quote. A completed retry returns the prior receipt.';
    if (tool.name === 'xguard.pricing.quote') tool.description =
      'Get an optional signed quote for xguard.web.fetch. Call xguard.web.fetch directly to receive the price in an HTTP 402 challenge.';
    const meta = tool._meta as Record<string, Record<string, unknown> | undefined> | undefined;
    if (meta?.['xguard/pricing']) delete meta['xguard/pricing'].payment_readiness;
    if (meta?.['xguard/payment']) delete meta['xguard/payment'].payment_readiness;
    if (meta?.['xguard/next']) delete meta['xguard/next'].quote_url_optional;
    return { ...tool, inputSchema: { ...tool.inputSchema, type: 'object' as const } };
  }) as ListToolsResult['tools'];
  return { tools: [{
    name: factTool,
    description: 'Read one free published software fact by canonical ID. Returns the primary source, verification status and timestamp. Use xguard.web.fetch for a separate paid fetch of a public URL.',
    inputSchema: { type: 'object', properties: { factId: factIdSchema }, required: ['factId'], additionalProperties: false },
    annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  }, ...[{ name: 'xguard.authority.catalog', description: 'Inspect the signed delegation sandbox, limits and unactivated service-fee contract.', inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } }, { name: 'xguard.authority.command', description: 'Submit an owner/agent-signed authority envelope. Requires explicit key-holder authorization; the tool cannot sign for the caller. Sandbox is not a payment.', inputSchema: { type: 'object' as const, required: ['envelope', 'organization_token'], additionalProperties: false, properties: { envelope: authorityEnvelopeSchema, organization_token: { type: 'string', minLength: 43, maxLength: 43 } } }, annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true } }, { name: 'xguard.authority.verify_receipt', description: 'Verify a financial authority receipt against the existing ProofRail key, without charging.', inputSchema: { type: 'object' as const, required: ['receipt'], additionalProperties: false, properties: { receipt: { type: 'string', maxLength: 8192 } } }, annotations: { readOnlyHint: true, idempotentHint: true } }], ...existingTools, ...OPERATIONS.map(d => ({ name: 'xguard.' + d.route.replaceAll('-', '_'), description: d.description + ` Price: ${Number(d.amount) / 1e6} USDC on Base. Sign only the canonical HTTP x402 offer and preserve the idempotency key and original quote.`, inputSchema: { ...paidInputSchema(d.route), type: 'object' as const, properties: { ...paidInputSchema(d.route).properties, idempotency_key: { type: 'string', minLength: 8, maxLength: 128 } }, required: [...paidInputSchema(d.route).required, 'idempotency_key'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } })), ...(extractEnabled() ? [{ name: 'xguard.extract', description: EXTRACT_SERVICE.description + ' Price: 0.012 USDC on Base. Uses x402 v2 HTTP payment headers: retry identical arguments and idempotency key with Payment-Signature and X-XGuard-Quote; the authorization is for the canonical HTTP API resource. No source is fetched before payment.', inputSchema: { ...paidInputSchema('extract'), type: 'object' as const, properties: { ...paidInputSchema('extract').properties, idempotency_key: { type: 'string', minLength: 8, maxLength: 128 } }, required: ['urls', 'max_amount_atomic', 'idempotency_key'] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true } }] : [])] };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

// Fill omissions only when the request identifies one credential-free read.
// The SDK still checks all explicit header and envelope values for conflicts.
function recoverPublicRead(request: Request, message: Record<string, unknown>, mediaType: string) {
  const { id, method, params = {} } = message;
  if (message.jsonrpc !== '2.0' || (typeof id !== 'string' && typeof id !== 'number') ||
      typeof method !== 'string' || !record(params) ||
      credentialHeaders.some(name => request.headers.has(name))) return;
  const tool = method === 'tools/call' && typeof params.name === 'string' ? params.name : undefined;
  if (!publicMethods.has(method) && (!tool || !publicTools.has(tool))) return;

  const meta = params._meta === undefined ? {} : params._meta;
  if (!record(meta)) return;
  const headers = new Headers(request.headers);
  const claimed = headers.get('mcp-protocol-version');
  const accept = headers.get('accept');
  if ((claimed !== null && claimed !== modernVersion) ||
      (Object.hasOwn(meta, versionKey) && meta[versionKey] !== modernVersion)) return;
  // Keep the original legacy negotiation for unversioned Streamable HTTP clients.
  if (claimed === null && !Object.hasOwn(meta, versionKey) && method !== 'server/discover' &&
      mediaType === 'application/json' && accept?.includes('text/event-stream')) return;

  const changes: string[] = [];
  for (const [name, value] of [['mcp-protocol-version', modernVersion], ['mcp-method', method],
    ...(tool ? [['mcp-name', tool]] : [])]) {
    if (!headers.has(name)) {
      headers.set(name, value);
      changes.push(name);
    }
  }
  if (mediaType !== 'application/json') {
    headers.set('content-type', 'application/json');
    changes.push('content-type');
  }
  if (accept === null || accept.trim() === '*/*') {
    headers.set('accept', 'application/json');
    changes.push('accept');
  }
  const missingVersion = !Object.hasOwn(meta, versionKey);
  const missingCapabilities = !Object.hasOwn(meta, capabilitiesKey);
  if (missingVersion || missingCapabilities) {
    message = { ...message, params: { ...params, _meta: {
      ...meta, ...(missingVersion ? { [versionKey]: modernVersion } : {}),
      ...(missingCapabilities ? { [capabilitiesKey]: {} } : {}),
    } } };
    changes.push('request-metadata');
  }
  if (!changes.length) return;
  logNormalization(request, changes);
  headers.delete('content-length');
  return { request: new Request(request.url, { method: request.method, headers, signal: request.signal }), message };
}

async function transport(request: Request, env: Env, readPublishedFact: (request: Request) => Promise<Response>): Promise<Response> {
  const url = new URL(request.url);
  if (!origins.includes(url.origin) || url.search) return rpcError(null, -32600, 'Invalid MCP endpoint', 400);
  const origin = request.headers.get('origin');
  if (origin !== null && !origins.includes(origin)) return rpcError(null, -32000, 'Origin not allowed', 403);
  if (request.method === 'OPTIONS') return new Response(null, { status: 204 });
  if ((request.method === 'GET' || request.method === 'HEAD') && !request.headers.has('mcp-protocol-version') &&
      !request.headers.get('accept')?.toLowerCase().includes('text/event-stream')) return Response.json(mcpServerCard);
  if (request.method !== 'POST') return rpcError(null, -32000, 'Send MCP JSON-RPC messages with POST', 405, {
    install: integrationLinks.install, server_card: integrationLinks.mcp_server_card,
  });
  const mediaType = request.headers.get('content-type')?.split(';', 1)[0].trim().toLowerCase() ?? '';
  const wrongMediaType = () => rpcError(null, -32600, 'Content-Type must be application/json', 415);
  if (!['application/json', 'text/plain', ''].includes(mediaType)) return wrongMediaType();

  // Reject duplicate fields, invalid UTF-8, oversized streams and batches
  // before SDK dispatch. Parsing a single message also keeps HTTP payment
  // headers unambiguously bound to one operation.
  const parsed = await jsonBody(request, maxBody);
  if (!('value' in parsed)) return parsed.error === 'payload_too_large'
    ? rpcError(null, -32700, 'Request body exceeds the 32 KiB limit', 413)
    : mediaType !== 'application/json' ? wrongMediaType()
      : rpcError(null, -32700, 'Send one complete UTF-8 JSON-RPC object without duplicate fields', 400);
  if (!record(parsed.value)) return mediaType !== 'application/json' ? wrongMediaType()
    : rpcError(null, -32600, 'Expected one JSON-RPC message', 400);
  const recovered = recoverPublicRead(request, parsed.value, mediaType);
  if (mediaType !== 'application/json' && !recovered) return wrongMediaType();

  const scope: { legacy: boolean; failure?: PaymentResponse; success?: Headers } = { legacy: false };
  const id = 'xgr_' + crypto.randomUUID().replaceAll('-', '');
  const handler = createMcpHandler(({ era }) => {
    scope.legacy = era === 'legacy';
    const server = new Server({ name: 'xguard-live', version: VERSION }, {
      capabilities: { tools: { listChanged: false } },
      instructions: 'Read published facts for free with xguard.fact.get. Paid web fetch uses x402 v2 HTTP headers and executes only after a verified settlement.',
    });
    server.setRequestHandler('tools/list', () => list(env));
    server.setRequestHandler('tools/call', async ({ params }, ctx) => {
      const { name, arguments: args = {} } = params;
      const rpcId = ctx.mcpReq.id;
      const fail = (response: Response) => {
        scope.failure = { id: rpcId, response };
        return { isError: true, content: [{ type: 'text' as const, text: 'Tool request rejected' }] };
      };
      const observation = { transport: 'mcp-live', resource: request.url };
      let response: Response;
      if (name === factTool) {
        const failure = (text: string) => ({ isError: true, content: [{ type: 'text' as const, text }] });
        if (!isPublicFactId(args.factId) || Object.keys(args).length !== 1) {
          return failure('Expected a canonical public fact ID, for example npm/react/latest-version.');
        }
        try {
          const fact = await readPublicFact(args.factId, readPublishedFact);
          if (!fact) return failure('Published fact not found.');
          if (!/^XGuard(?:Live|[-/])/i.test(request.headers.get('user-agent') || '') &&
              request.headers.get('x-xguard-traffic-class') !== 'synthetic') {
            console.info(JSON.stringify({ event: 'xguard_public_fact_read', transport: 'mcp' }));
          }
          return { content: [{ type: 'text' as const, text: JSON.stringify(fact) }], structuredContent: fact };
        } catch {
          return failure('Public fact temporarily unavailable.');
        }
      }
      if (!toolNames.has(name)) return fail(Response.json({ error: 'unknown_tool' }, { status: 400 }));
      try {
        const networkOperation = OPERATIONS.find(d => name === 'xguard.' + d.route.replaceAll('-', '_'));
        if (name.startsWith('xguard.authority.')) {
          if (name === 'xguard.authority.catalog') {
            if (Object.keys(args).length) return fail(Response.json({ error: 'invalid_arguments' }, { status: 400 }));
            response = Response.json(authorityCatalog());
          } else {
            const envelope = args.envelope as Record<string, unknown> | undefined;
            const path = name.endsWith('verify_receipt') ? 'verify-receipt' : envelope?.action;
            if (typeof path !== 'string' || !/^[a-z-]+$/.test(path) || Object.keys(args).length !== (name.endsWith('verify_receipt') ? 1 : 2)) return fail(Response.json({ error: 'invalid_arguments' }, { status: 400 }));
            response = await financialAuthorityFetch(new Request('https://api.xguardgate.com/v1/authority/' + path, { method: 'POST', headers: { 'content-type': 'application/json', 'x-xguard-organization-token': typeof args.organization_token === 'string' ? args.organization_token : '' }, body: JSON.stringify(name.endsWith('verify_receipt') ? args : envelope) }), env) || Response.json({ error: 'authority_unavailable' }, { status: 503 });
          }
        } else if (networkOperation || name === 'xguard.extract' && extractEnabled()) {
          const { idempotency_key, ...input } = args;
          const headers = new Headers(request.headers); headers.set('content-type', 'application/json');
          if (typeof idempotency_key === 'string') headers.set('idempotency-key', idempotency_key);
          const pending: Promise<any>[] = [];
          response = await livePaidFetch(new Request(PAID_BASE + '/' + (networkOperation?.route || 'extract'), { method: 'POST', headers, body: JSON.stringify(input) }), env, { waitUntil: (p: Promise<any>) => pending.push(p) }) || Response.json({ error: 'paid_route_unavailable' }, { status: 503 });
          await Promise.all(pending);
        } else if (name === 'xguard.capabilities') {
          if (Object.keys(args).length) return fail(Response.json({ error: 'invalid_arguments' }, { status: 400 }));
          response = Response.json({ name: 'XGuard Live', endpoint: request.url,
            payment: 'x402-v2-http', discovery_requires_payment: false,
            tools: list(env).tools.map(({ name, description }) => ({ name, description })) });
        } else if (name === 'xguard.preflight') {
          response = await handlePreflight(env, args, id, observation);
        } else if (name === 'xguard.pricing.quote') {
          response = (await issueQuote(env, args, id, observation)).response;
        } else {
          // Public discovery needs no token. Paid tool authorization is the
          // scoped x402 proof; cookies and bearer tokens cannot authorize it.
          if (request.headers.has('x-xguard-credit')) {
            return fail(Response.json({ error: 'use_original_credit_endpoint' }, { status: 400 }));
          }
          response = await handlePaidWebFetch(request, env, id, args, args.testnet === true, 'mcp-live');
        }
        if (!response.ok) return fail(response);
        const value = await response.json();
        scope.success = response.headers;
        return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value };
      } catch {
        console.error(JSON.stringify({ event: 'xguard_mcp_tool_dependency_failure', request_id: id, tool: name }));
        return fail(Response.json({ error: 'tool_dependency_unavailable' }, { status: 503 }));
      }
    });
    return server;
  }, { legacy: 'stateless', maxRequestBodySize: maxBody, keepAliveMs: 0 });

  let response = await handler.fetch(recovered?.request ?? request, { parsedBody: recovered?.message ?? parsed.value });
  if (scope.legacy && response.headers.get('content-type')?.startsWith('text/event-stream')) {
    // 2025 clients may get an SSE response scoped to this POST. Read the one
    // terminal exchange before committing headers so an x402 failure stays 402.
    const text = await response.text();
    const terminal = text.split(/\r?\n/).find(line => line.startsWith('data: ') && line !== 'data: ');
    const envelope = terminal ? JSON.parse(terminal.slice(6)) : null;
    if (envelope?.error) {
      const status = envelope.error.code === -32601 ? 404 : envelope.error.code === -32603 ? 500 : 400;
      response = Response.json(envelope, { status });
    } else {
      response = new Response(text, { status: response.status, headers: response.headers });
    }
  }
  if (scope.failure) return toolFailure(scope.failure);
  if (!scope.success) return response;
  const headers = new Headers(response.headers);
  for (const name of paymentHeaders) {
    const value = scope.success.get(name);
    if (value) headers.set(name, value);
  }
  return new Response(response.body, { status: response.status, headers });
}

export async function liveMcpFetch(request: Request, env: Env, readPublishedFact: (request: Request) => Promise<Response>) {
  let response: Response;
  try {
    response = await transport(request, env, readPublishedFact);
  } catch {
    // Never log caller arguments, quote, payment authorization, or headers.
    console.error(JSON.stringify({ event: 'xguard_mcp_dependency_failure' }));
    response = rpcError(null, -32603, 'MCP dependency unavailable', 503);
  }
  return rpcHeaders(response, request, env);
}
