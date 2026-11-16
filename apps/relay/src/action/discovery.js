import { actionFetch } from './gateway.js';
export const actionTools = [
  { name: 'xguard.action.catalog', description: 'List bounded Action Cloud services, final card prices, checkout URLs and actual PayPal activation blockers. No payment or execution.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
  { name: 'xguard.action.quote', description: 'Validate task input and review its final USD price without payment or external execution. Human approval takes place at the shared checkout.', inputSchema: { type: 'object', properties: { service: { type: 'string' }, input: { type: 'object' } }, required: ['service', 'input'], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
  { name: 'xguard.action.result', description: 'Recover the original paid result and signed receipt with its private recovery key. Never creates or charges another order.', inputSchema: { type: 'object', properties: { order_id: { type: 'string', pattern: '^xgo_[a-f0-9]{40}$' }, recovery_token: { type: 'string', minLength: 40, maxLength: 128 } }, required: ['order_id', 'recovery_token'], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
];
export const actionToolNames = new Set(actionTools.map(x => x.name));
export async function actionTool(request, env, name, args) {
  let path = '/v1/checkout/catalog', method = 'GET'; const headers = { 'content-type': 'application/json' };
  if (name.endsWith('.quote')) { path = '/v1/checkout/quote'; method = 'POST'; }
  if (name.endsWith('.result')) {
    if (!/^xgo_[a-f0-9]{40}$/.test(args.order_id || '')) return Response.json({ error: 'invalid_order_id' }, { status: 400 });
    path = '/v1/checkout/orders/' + args.order_id; headers['x-xguard-checkout-token'] = args.recovery_token || '';
  }
  return actionFetch(new Request('https://xguardgate.com' + path, { method, headers, ...(method === 'POST' ? { body: JSON.stringify(args) } : {}) }), env);
}
export const actionSkills = actionTools.map(t => ({ id: t.name, name: t.name.replaceAll('.', ' '), description: t.description, tags: ['action-cloud', 'checkout', 'digital-tasks'], examples: [JSON.stringify({ action: t.name, input: {} })], inputModes: ['application/json'], outputModes: ['application/json'], securityRequirements: [] }));
export function actionPaths() {
  const responses = { 200: { description: 'Server price, configuration or original order result' }, 400: { description: 'Invalid request' }, 401: { description: 'Recovery key required' }, 404: { description: 'Order missing or unauthorized' }, 409: { description: 'Idempotency or provider identity conflict' }, 422: { description: 'Input rejected before payment' }, 429: { description: 'Daily capacity exhausted' }, 503: { description: 'Activation, provider or storage unavailable' } };
  const recovery = { name: 'X-XGuard-Checkout-Token', in: 'header', required: true, schema: { type: 'string', minLength: 40, maxLength: 128 }, description: 'Private buyer capability; never put in a URL' };
  const orderId = { name: 'order_id', in: 'path', required: true, schema: { type: 'string', pattern: '^xgo_[a-f0-9]{40}$' } };
  const schema = { type: 'object', required: ['service', 'input'], additionalProperties: false, properties: { service: { type: 'string' }, input: { type: 'object' } } };
  const body = { required: true, content: { 'application/json': { schema } } };
  return {
    ...Object.fromEntries(['catalog', 'config', 'proof-key'].map(path => ['/v1/checkout/' + path, { get: { operationId: 'action_' + path.replace('-', '_'), responses } }])),
    '/v1/checkout/quote': { post: { operationId: 'action_quote', requestBody: body, responses } },
    '/v1/checkout/orders': { post: { operationId: 'action_create_order', requestBody: body, parameters: [recovery, { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 100 } }], responses } },
    '/v1/checkout/orders/{order_id}': { get: { operationId: 'action_recover_order', parameters: [orderId, recovery], responses } },
    '/v1/checkout/orders/{order_id}/capture': { post: { operationId: 'action_capture_order', description: 'Only after buyer approval. Exact completed capture is required before execution.', parameters: [orderId, recovery], responses } },
    '/v1/checkout/webhooks/paypal': { post: { operationId: 'action_paypal_webhook', description: 'Signed PayPal events only; verified server-side before canonical order reconciliation.', responses } },
  };
}
