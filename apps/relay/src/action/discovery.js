import { actionFetch } from './gateway.js';
import { commerceFetch } from '../business/http.js';
const empty = { type: 'object', properties: {}, additionalProperties: false };
const commercialInput = { type: 'object', required: ['service', 'input'], properties: { service: { type: 'string' }, input: { type: 'object' } }, additionalProperties: false };
const recoveryInput = { type: 'object', properties: { order_id: { type: 'string', pattern: '^xgo_[a-f0-9]{40}$' }, recovery_token: { type: 'string', minLength: 40, maxLength: 128 } }, required: ['order_id', 'recovery_token'], additionalProperties: false };
/** @type {Array<[string, string, object]>} */
const commercialDefinitions = [
  ['xguard_search_offers', 'Search only operator-approved partner offers. Empty results mean no commercial agreement is configured. No invented suppliers, prices or capacity.', { type: 'object', properties: { q: { type: 'string', maxLength: 150 }, capability: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' } }, additionalProperties: false }],
  ['xguard_compare_suppliers', 'Free comparison of up to 10 approved partners, disclosing referral relationships. Unconnected prices remain unknown.', { type: 'object', required: ['partner_ids'], properties: { partner_ids: { type: 'array', minItems: 1, maxItems: 10, uniqueItems: true, items: { type: 'string', pattern: '^[a-z0-9-]{1,80}$' } } }, additionalProperties: false }],
  ['xguard_find_enterprise_software', 'Find contracted enterprise-software partners, if any. Does not search private user data or create a sales lead.', empty],
  ['xguard_find_gpu_capacity', 'Find approved GPU partners. Actual capacity is unknown until a funded provider feed exists. Existing compute readiness remains at /compute.', empty],
  ['xguard_request_quote', 'Validate a paid service input and return a server-derived USD price. Does not charge, contact a supplier or execute a task.', commercialInput],
  ['xguard_get_verified_facts', 'Get the paid fact-bundle checkout and agent endpoint. This tool does not claim to retrieve paid facts before settlement. Public fact discovery stays available through existing fact tools.', empty],
  ['xguard_negotiate_offer', 'Report negotiation activation requirements. Autonomous supplier negotiation is unavailable until a contracted supplier adapter and authority exist; no offer is sent.', empty],
  ['xguard_create_deal', 'Report deal-execution activation requirements. No binding deal is created without approved counterparties, terms and an execution adapter.', empty],
  ['xguard_purchase_service', 'Return the exact service price and shared checkout link for buyer authorization. This tool never charges a buyer.', { type: 'object', required: ['service'], properties: { service: { type: 'string', maxLength: 100 } }, additionalProperties: false }],
  ['xguard_verify_payment', 'Read the original known order state using its private recovery key; no new capture, transfer or purchase.', recoveryInput],
  ['xguard_get_receipt', 'Recover the existing signed paid-delivery receipt using the original private recovery key. Missing or pending delivery is explicit.', recoveryInput],
];
const commerceTools = commercialDefinitions.map(([name, description, inputSchema]) => ({ name, description, inputSchema, annotations: { readOnlyHint: true, idempotentHint: true } }));
export const actionTools = [
  ...commerceTools,
  { name: 'xguard.action.catalog', description: 'List bounded Action Cloud services, final card prices, checkout URLs and actual PayPal activation blockers. No payment or execution.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
  { name: 'xguard.action.quote', description: 'Validate task input and review its final USD price without payment or external execution. Human approval takes place at the shared checkout.', inputSchema: { type: 'object', properties: { service: { type: 'string' }, input: { type: 'object' } }, required: ['service', 'input'], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
  { name: 'xguard.action.result', description: 'Recover the original paid result and signed receipt with its private recovery key. Never creates or charges another order.', inputSchema: { type: 'object', properties: { order_id: { type: 'string', pattern: '^xgo_[a-f0-9]{40}$' }, recovery_token: { type: 'string', minLength: 40, maxLength: 128 } }, required: ['order_id', 'recovery_token'], additionalProperties: false }, annotations: { readOnlyHint: true, idempotentHint: true } },
];
export const actionToolNames = new Set(actionTools.map(x => x.name));
export async function actionTool(request, env, name, args) {
  if (commerceTools.some(t => t.name === name)) {
    if (['xguard_negotiate_offer', 'xguard_create_deal'].includes(name)) return Response.json({ error: 'commercial_execution_not_activated', status: 'Awaiting Commercial Partnership', dependencies: ['Verified supplier agreement', 'Scoped negotiation or purchase authority', 'Tested order and commission adapter'], messages_sent: 0, deals_created: 0, funds_moved: false }, { status: 503 });
    if (name === 'xguard_request_quote') return actionFetch(new Request('https://xguardgate.com/v1/checkout/quote', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(args) }), env);
    if (['xguard_verify_payment', 'xguard_get_receipt'].includes(name)) {
      if (!/^xgo_[a-f0-9]{40}$/.test(args.order_id || '')) return Response.json({ error: 'invalid_order_id' }, { status: 400 });
      return actionFetch(new Request('https://xguardgate.com/v1/checkout/orders/' + args.order_id, { headers: { 'x-xguard-checkout-token': args.recovery_token || '' } }), env);
    }
    let path = '/v1/commerce/offers/search', method = 'GET', body;
    if (name === 'xguard_compare_suppliers') { path = '/v1/commerce/offers/compare'; method = 'POST'; body = args; }
    else if (name === 'xguard_purchase_service' || name === 'xguard_get_verified_facts') { path = '/v1/commerce/purchase'; method = 'POST'; body = name === 'xguard_get_verified_facts' ? { service: 'live-batch' } : args; }
    else { const query = new URLSearchParams(); for (const k of ['q', 'capability']) if (args[k]) query.set(k, String(args[k])); if (name === 'xguard_find_enterprise_software') query.set('capability', 'enterprise-software'); if (name === 'xguard_find_gpu_capacity') query.set('capability', 'gpu'); path += '?' + query; }
    return commerceFetch(new Request('https://xguardgate.com' + path, { method, headers: { 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) }), env);
  }
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
    ...Object.fromEntries(['catalog', 'providers', 'partners', 'offers/search'].map(path => ['/v1/commerce/' + path, { get: { operationId: 'commerce_' + path.replaceAll('/', '_'), responses } }])),
    '/v1/commerce/offers/compare': { post: { operationId: 'commerce_compare_suppliers', requestBody: { required: true, content: { 'application/json': { schema: commerceTools.find(t => t.name === 'xguard_compare_suppliers').inputSchema } } }, responses } },
    '/v1/commerce/purchase': { post: { operationId: 'commerce_purchase_link', description: 'Returns a checkout link. No payment or execution.', requestBody: { required: true, content: { 'application/json': { schema: commerceTools.find(t => t.name === 'xguard_purchase_service').inputSchema } } }, responses } },
    ...Object.fromEntries(['catalog', 'config', 'proof-key'].map(path => ['/v1/checkout/' + path, { get: { operationId: 'action_' + path.replace('-', '_'), responses } }])),
    '/v1/checkout/quote': { post: { operationId: 'action_quote', requestBody: body, responses } },
    '/v1/checkout/orders': { post: { operationId: 'action_create_order', requestBody: body, parameters: [recovery, { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 16, maxLength: 100 } }], responses } },
    '/v1/checkout/orders/{order_id}': { get: { operationId: 'action_recover_order', parameters: [orderId, recovery], responses } },
    '/v1/checkout/orders/{order_id}/capture': { post: { operationId: 'action_capture_order', description: 'Only after buyer approval. Exact completed capture is required before execution.', parameters: [orderId, recovery], responses } },
    '/v1/checkout/webhooks/paypal': { post: { operationId: 'action_paypal_webhook', description: 'Signed PayPal events only; verified server-side before canonical order reconciliation.', responses } },
  };
}
