import { PRODUCT, DESCRIPTION } from './core/identity.js';
import { describeGovernance } from './governance-openapi.js';
export const PAID_API_DISCOVERY = {
  product: 'Paid API Gateway',
  description: 'Turn any API into a paid API for AI agents. Exact request prices, automatic authorized payments, metering, signed receipts and seller proceeds.',
  catalog: 'https://api.xguardgate.com/v1/marketplace/services',
  seller_onboarding: 'https://xguardgate.com/sellers',
  paid_demo: 'https://api.xguardgate.com/p/xguard/feed-digest/',
  payment: 'x402 v2 exact USDC on Base',
  buyer_account_required: false,
  authorization: 'An owner-authorized funded wallet and spending policy are required to buy. Price inspection never signs or charges.',
};
export async function decorateSellerDiscovery(request, response) {
  const path = new URL(request.url).pathname;
  if (request.method !== 'GET' || !response.ok || !response.headers.get('content-type')?.includes('json') || !['/', '/openapi.json', '/a2a', '/mcp', '/v1/capabilities', '/.well-known/agent-card.json', '/.well-known/agent.json', '/.well-known/mcp/server-card.json', '/.well-known/xguard-tools.json', '/.well-known/payment-manifest', '/.well-known/payment-manifest.json', '/.well-known/x402', '/.well-known/x402.json'].includes(path)) return response;
  const body = await response.json();
  body[path === '/openapi.json' ? 'x-paid-api-gateway' : 'paid_api_gateway'] = PAID_API_DISCOVERY;
  if (path === '/' || path === '/v1/capabilities') { body.primary_product = PRODUCT; body.primary_role = DESCRIPTION; }
  const card = path === '/a2a' ? body.agent_card : path.includes('/agent') ? body : null;
  if (card) { card.description = DESCRIPTION; card.skills = [{ id: 'paid-api-catalog', name: 'Discover purchasable APIs', description: `Find available seller APIs and exact prices at ${PAID_API_DISCOVERY.catalog}. Call each listed endpoint with an authorized x402 client.`, tags: ['paid-api', 'catalog', 'payments'], examples: ['Find a paid feed digest API'] }, ...(card.skills || [])]; }
  if (path === '/openapi.json') {
    body.info.description = DESCRIPTION;
    body.components ||= {}; body.components.securitySchemes ||= {};
    body.components.securitySchemes.SellerToken = { type: 'http', scheme: 'bearer', description: 'One-time seller control token from POST /v1/sellers' };
    const reply = { description: 'Result or structured error', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
    for (const [route, method, summary, auth] of [
      ['/v1/marketplace/services', 'get', 'Find available paid APIs'],
      ['/v1/sellers', 'post', 'Create a seller identity and receive a one-time control token'],
      ['/v1/sellers/services', 'post', 'Register an HTTPS API, request price, payout wallet and optional upstream secret', 'SellerToken'],
      ['/v1/sellers/services', 'get', 'List this seller’s services and activation blockers', 'SellerToken'],
      ['/v1/sellers/dashboard', 'get', 'Inspect seller receivables, actual payouts and transactions', 'SellerToken'],
      ['/internal/revenue-funnel', 'get', 'Inspect separate real, synthetic, internal, crawler, registry and monitoring ledgers', 'OperatorMetrics'],
    ]) {
      body.paths[route] ||= {};
      body.paths[route][method] = { summary, ...(auth ? { security: [{ [auth]: [] }] } : {}), ...(method === 'post' ? { requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } } } : {}), responses: { '200': reply, '201': reply, '400': reply, '401': reply, '503': reply } };
    }
    body.paths['/p/{seller}/{service}/{path}'] = {
      parameters: ['seller', 'service', 'path'].map(name => ({ name, in: 'path', required: true, schema: { type: 'string' } })),
      ...Object.fromEntries(['get', 'post', 'put', 'patch', 'delete', 'head'].map(method => [method, { summary: 'Pay for one seller API request; exact method, body and path are quote-bound', parameters: [{ name: 'Idempotency-Key', in: 'header', required: !['get','head'].includes(method), schema: { type: 'string', minLength: 8, maxLength: 128 } }], responses: { '200': { description: 'Original bounded upstream response with Payment-Response, X-XGuard-Receipt and X-XGuard-Proof headers' }, '402': reply, '409': reply, '502': reply, '503': reply } }])) };
  }
  if (path === '/openapi.json') describeGovernance(body);
  const headers = new Headers(response.headers); headers.delete('content-length');
  return new Response(JSON.stringify(body), { status: response.status, headers });
}
