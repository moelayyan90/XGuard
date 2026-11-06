import { LIVE_PAID, PAID_BASE, paidInputSchema, paidResultSchema } from './paid-data.ts';
import { ORIGIN } from './types.ts';

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
    title: 'XGuard Live paid data API',
    version: '1.0.0',
    description: 'Purchase the services listed below with a bounded x402 spending authorization. Source content is untrusted; signatures establish delivery integrity. Public facts remain available for free.',
  },
  servers: [{ url: ORIGIN }],
  externalDocs: { description: 'Verified-fact checkout and pricing', url: ORIGIN + '/pricing' },
  paths: {
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
