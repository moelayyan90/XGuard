import { authorityPaths } from '../financial-authority/http.js';
import { LIVE_PAID, PAID_BASE, paidInputSchema, paidResultSchema } from './paid-data.ts';
import { ORIGIN } from './types.ts';
import { OPERATIONS } from '../network/catalog.ts';
import { networkSchema } from '../network/engine.ts';

const apiOrigin = new URL(PAID_BASE).origin;
const paidPath = new URL(PAID_BASE).pathname;
const header = (name: string, description: string, required = false) => ({
  name, in: 'header', required, description, schema: { type: 'string' },
});
const responseHeader = (description: string) => ({ description, schema: { type: 'string' } });
const jsonContent = (schema: object) => ({ 'application/json': { schema } });

export const liveOpenApi = {
  openapi: '3.1.0',
  info: {
    title: 'XGuard — Secretless Agent Gateway',
    version: '1.0.0',
    contact: { name: 'Mohammad Elayyan', email: 'mo.elayyan2023@gmail.com', url: ORIGIN + '/identity' },
    description: 'XGuard — Secretless Agent Gateway with an x402 v2 facilitator/settlement compatibility surface. Purchase the services listed below with a bounded x402 spending authorization. Source content is untrusted; signatures establish delivery integrity. Public facts remain available for free.',
  },
  servers: [{ url: ORIGIN }],
  externalDocs: { description: 'Verified-fact checkout and pricing', url: ORIGIN + '/pricing' },
  paths: {
    ...authorityPaths(),
    ...Object.fromEntries(Object.entries({ '/v1/routes/resolve': 'route-resolve', '/v1/routes/compare': 'route-compare', '/v1/discover': 'discover', '/v1/discover/platforms': 'platform-discovery', '/v1/crawl': 'crawl', '/v1/facts': 'fact', '/v1/tasks': 'task', '/v1/schedules': 'schedule', '/v1/verify': 'verify' }).map(([path, route]) => [path, { post: { servers: [{ url: apiOrigin }], operationId: 'network_' + route.replaceAll('-', '_'), summary: OPERATIONS.find(d => d.route === route)!.name, parameters: [header('Idempotency-Key', 'Stable across retries.', true), header('Payment-Signature', 'x402 v2 exact authorization'), header('X-XGuard-Quote', 'Original signed quote')], requestBody: { required: true, content: jsonContent(networkSchema(route)) }, responses: { 200: { description: 'Purchased operation result; task creation returns a task ID and task token.' }, 400: { description: 'Input invalid' }, 402: { description: 'x402 payment required' }, 503: { description: 'Dependency or payment unavailable' } } } }])),
    '/v1/tasks/{id}': { get: { servers: [{ url: apiOrigin }], operationId: 'networkTaskStatus', parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^xgtask_[a-f0-9]{32}$' } }, header('Authorization', 'Bearer task_token', true)], responses: { 200: { description: 'Durable task state' }, 404: { description: 'Task unknown or unauthorized' } } } },
    ...Object.fromEntries(['resume', 'cancel', 'verify'].map(action => ['/v1/tasks/{id}/' + action, { post: { servers: [{ url: apiOrigin }], operationId: 'networkTask' + action, parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string', pattern: '^xgtask_[a-f0-9]{32}$' } }, header('Authorization', 'Bearer task_token', true)], responses: { 200: { description: 'Original bounded task contract updated or inspected; no new charge' }, 404: { description: 'Task unknown or unauthorized' }, 409: { description: 'Terminal task or exhausted retry budget' } } } }])),
    '/v1/capabilities': { get: { servers: [{ url: apiOrigin }], operationId: 'networkCapabilities', responses: { 200: { description: 'Billable operation metadata and exact bounded scope' } } } },
    '/v1/payments/coverage': { get: { servers: [{ url: apiOrigin }], operationId: 'networkPaymentCoverage', responses: { 200: { description: 'Configured payment integration and explicit eligibility blockers' } } } },
    '/supported': { get: { servers: [{ url: apiOrigin }], operationId: 'getSupportedPaymentKinds', summary: 'x402 v2 facilitator discovery: exact on Base Mainnet (eip155:8453)', responses: { 200: { description: 'Supported x402 kinds, extensions and signers', content: jsonContent({ type: 'object', required: ['kinds', 'extensions', 'signers'], properties: { kinds: { type: 'array', items: { type: 'object', properties: { x402Version: { type: 'integer', const: 2 }, scheme: { type: 'string', const: 'exact' }, network: { type: 'string', const: 'eip155:8453' } } } }, extensions: { type: 'array', items: { type: 'string' } }, signers: { type: 'object' } } }) } } } },
    ...Object.fromEntries(['verify', 'settle'].map(operation => ['/' + operation, { post: { servers: [{ url: apiOrigin }], operationId: operation + 'X402Payment', summary: 'x402 v2 facilitator ' + operation + ' through the existing non-custodial relay', requestBody: { required: true, content: jsonContent({ type: 'object', required: ['paymentPayload', 'paymentRequirements'], properties: { paymentPayload: { type: 'object' }, paymentRequirements: { type: 'object' } } }) }, responses: { 200: { description: operation === 'verify' ? 'Verification result' : 'Confirmed settlement result' }, 400: { description: 'Invalid payment; no settlement for invalid input' }, 402: { description: 'Existing settlement quota or license admission applies' }, 503: { description: 'Unavailable or uncertain; fail closed' } } } }])),
    '/.well-known/x402': { get: { servers: [{ url: apiOrigin }], operationId: 'getX402FacilitatorIdentity', summary: 'Facilitator role, operator and canonical endpoints', responses: { 200: { description: 'Machine-readable x402 v2 facilitator identity' } } } },
    '/healthz': { get: { operationId: 'getLiveHealth', summary: 'Check public fact service health', responses: {
      200: { description: 'Public facts service reachable' },
      503: { description: 'Collector overdue or a dependency is unavailable' },
    } } },
    [paidPath + '/catalog']: { get: {
      servers: [{ url: apiOrigin }], operationId: 'getLivePaidCatalog', summary: 'Read available services, prices and recovery instructions',
      responses: { 200: { description: 'Service catalog' } },
    } },
    [paidPath + '/readiness']: { get: {
      servers: [{ url: apiOrigin }], operationId: 'getLivePaidReadiness', summary: 'Check availability before signing payment',
      responses: { 200: { description: 'Ready to quote' }, 503: { description: 'Purchase unavailable' } },
    } },
    ...Object.fromEntries(LIVE_PAID.map(service => [paidPath + '/' + service.route, { post: {
      servers: [{ url: apiOrigin }],
      operationId: service.id.replace('-', '_'),
      summary: service.name,
      description: service.description + ' Submit the unsigned request first. Sign only the returned x402 v2 exact offer on Base if it fits your USDC limit. Retry with the original body and idempotency key, the signature and the returned quote. After uncertainty, recover the original operation via the catalog instructions.',
      parameters: [
        { ...header('Idempotency-Key', 'Stable key for the initial call and all retries.', true), schema: { type: 'string', pattern: '^[A-Za-z0-9_-]{8,128}$' } },
        header('Payment-Signature', 'Base64 x402 v2 payment payload, for the authorized retry.'),
        header('X-XGuard-Quote', 'Original signed quote returned by the unsigned call.'),
      ],
      requestBody: { required: true, content: {
        'application/json': { schema: paidInputSchema(service.route), example: service.example },
      } },
      responses: {
        200: { description: 'Purchased result with settlement evidence and signed receipt', content: jsonContent(paidResultSchema) },
        400: { description: 'Invalid request, budget, idempotency key, or quote' },
        402: { description: 'Payment challenge or payment rejected', headers: {
          'Payment-Required': responseHeader('Base64 x402 v2 challenge when issuing an offer'),
          'X-XGuard-Quote': responseHeader('Signed XGuard quote when issuing an offer'),
        } },
        404: { description: 'Requested fact unavailable' },
        409: { description: 'Conflicting or already reserved payment operation' },
        413: { description: 'Request body too large' },
        415: { description: 'Expected application/json' },
        429: { description: 'Rate limit exceeded' },
        503: { description: 'Service unavailable or settlement uncertain. Recover the original operation before any new purchase.' },
      },
    } }])),
  },
};
