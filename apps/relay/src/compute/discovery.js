import { API } from './common.js';
import { computeFetch } from './gateway.js';

export const inferenceSchema = { type: 'object', required: ['model', 'max_amount_atomic', 'accept_provider_terms'], additionalProperties: false, properties: { model: { type: 'string', maxLength: 200 }, messages: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', required: ['role', 'content'], additionalProperties: false, properties: { role: { enum: ['system', 'user', 'assistant'] }, content: { type: 'string', maxLength: 8192 } } } }, input: { type: 'string', maxLength: 8192 }, max_tokens: { type: 'integer', minimum: 1, maximum: 4096, default: 128 }, temperature: { type: 'number', minimum: 0, maximum: 2 }, preferred_provider: { enum: ['openrouter', 'together'] }, max_amount_atomic: { type: 'string', pattern: '^[1-9][0-9]{0,9}$' }, payer: { type: 'string', pattern: '^0x[a-fA-F0-9]{40}$' }, accept_provider_terms: { const: true } }, oneOf: [{ required: ['messages'] }, { required: ['input'] }] };
export const gpuSchema = { type: 'object', required: ['template', 'gpu_type', 'region', 'max_amount_atomic', 'accept_provider_terms'], additionalProperties: false, properties: { template: { type: 'string' }, gpu_type: { type: 'string' }, region: { type: 'string' }, duration_seconds: { type: 'integer', minimum: 5, maximum: 300 }, image: { type: 'string', description: 'Must equal the reviewed template image digest.' }, command: { type: 'array', items: { type: 'string' }, description: 'Must equal the reviewed template command.' }, input: { type: 'object' }, preferred_provider: { const: 'runpod' }, payer: inferenceSchema.properties.payer, max_amount_atomic: inferenceSchema.properties.max_amount_atomic, accept_provider_terms: { const: true } } };
const mapping = {
  list_compute_providers: ['GET', '/v1/compute/providers', 'List configured compute adapters and explicit connection blockers.'],
  list_models: ['GET', '/v1/compute/models', 'List currently eligible configured inference models and GPU templates.'],
  quote_inference: ['POST', '/v1/inference/quote', 'Get a signed inference quote and exact x402 v2 USDC offer; no paid execution.'],
  execute_inference: ['POST', '/v1/inference/execute', 'Execute inference only after confirmed x402 settlement. Retry identical arguments with original quote and payment headers.'],
  quote_gpu_job: ['POST', '/v1/gpu/quote', 'Quote a bounded GPU job on a reviewed template. Arbitrary container provisioning is unavailable.'],
  execute_gpu_job: ['POST', '/v1/gpu/execute', 'Submit one paid bounded GPU job; poll the original purchase to retrieve its result and receipt.'],
  compute_health: ['GET', '/v1/compute/health', 'Check compute configuration and upstream health; does not establish a real canary.'],
  get_execution_receipt: ['GET', '/v1/compute/receipts/{quote_id}', 'Recover this purchase and signed receipt using its original private quote; never settles a second payment.'],
};
export const computeToolNames = new Set(Object.keys(mapping));
export const computeTools = Object.entries(mapping).map(([name, [method, , description]]) => {
  const base = name.includes('inference') ? inferenceSchema : name.includes('gpu_job') ? gpuSchema : { type: 'object', properties: {}, additionalProperties: false };
  const paid = method === 'POST', receipt = name === 'get_execution_receipt';
  return { name, description, inputSchema: { ...base, properties: { ...base.properties, ...(paid ? { idempotency_key: { type: 'string', minLength: 8, maxLength: 128 } } : {}), ...(receipt ? { quote_id: { type: 'string', pattern: '^xcq_[a-f0-9]{32}$' } } : {}) }, required: [...(base.required || []), ...(paid ? ['idempotency_key'] : []), ...(receipt ? ['quote_id'] : [])] }, annotations: { readOnlyHint: !name.startsWith('execute_'), destructiveHint: false, idempotentHint: true, openWorldHint: true } };
});
export async function computeTool(request, env, name, args) {
  const [method, path] = mapping[name];
  const headers = new Headers(request.headers); headers.set('content-type', 'application/json');
  const body = { ...args };
  if (method === 'POST') { headers.set('idempotency-key', body.idempotency_key || ''); delete body.idempotency_key; }
  if (name === 'get_execution_receipt' && !/^xcq_[a-f0-9]{32}$/.test(body.quote_id || '')) return Response.json({ error: 'invalid_quote_id' }, { status: 400 });
  return computeFetch(new Request(API + path.replace('{quote_id}', body.quote_id), { method, headers, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}) }), env, { country: request.cf?.country || '' });
}
export function computePaths() {
  const parameters = [{ name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', minLength: 8, maxLength: 128 } }, ...['Payment-Signature', 'X-XGuard-Quote'].map(name => ({ name, in: 'header', schema: { type: 'string' } }))];
  const responses = { 200: { description: 'Signed quote or completed execution with result and receipt' }, 202: { description: 'Original execution or settlement awaiting completion; no new purchase' }, 400: { description: 'Invalid input or proof' }, 402: { description: 'Exact x402 v2 USDC payment required' }, 409: { description: 'Conflict, requote or original paid liability; recover the same purchase' }, 422: { description: 'Input, eligibility, model or budget unavailable' }, 503: { description: 'Provider connection or payment dependency unavailable; no new payment requested' } };
  return {
    ...Object.fromEntries(['inference', 'gpu'].flatMap(kind => ['quote', 'execute'].map(action => ['/v1/' + kind + '/' + action, { post: { servers: [{ url: API }], operationId: kind + '_' + action, summary: action + ' bounded ' + kind + ' execution', parameters, requestBody: { required: true, content: { 'application/json': { schema: kind === 'gpu' ? gpuSchema : inferenceSchema } } }, responses } }]))),
    ...Object.fromEntries(['providers', 'models', 'availability', 'health', 'proof-key'].map(resource => ['/v1/compute/' + resource, { get: { servers: [{ url: API }], operationId: 'compute_' + resource.replace('-', '_'), responses: { 200: { description: 'Compute metadata' }, 503: { description: 'Not ready for purchases' } } } }])),
    '/v1/compute/route': { post: { servers: [{ url: API }], operationId: 'compute_route', parameters, requestBody: { required: true, content: { 'application/json': { schema: { oneOf: [{ ...inferenceSchema, properties: { ...inferenceSchema.properties, route: { const: 'inference_proxy' } } }, { ...gpuSchema, properties: { ...gpuSchema.properties, route: { const: 'gpu_job_execute' } } }] } } } }, responses } },
    ...Object.fromEntries(['executions', 'receipts'].map(resource => ['/v1/compute/' + resource + '/{quote_id}', { get: { servers: [{ url: API }], operationId: 'compute_' + resource, parameters: [{ name: 'quote_id', in: 'path', required: true, schema: { type: 'string', pattern: '^xcq_[a-f0-9]{32}$' } }, { name: 'X-XGuard-Quote', in: 'header', required: true, schema: { type: 'string' } }], responses } }])),
    '/v1/compute/metrics': { get: { servers: [{ url: API }], operationId: 'compute_metrics', parameters: [{ name: 'Authorization', in: 'header', required: true, schema: { type: 'string' }, description: 'Bearer existing operator key' }], responses: { 200: { description: 'Private daily compute accounting and provider counters' }, 401: { description: 'Operator authorization required' } } } },
  };
}
export const computeSkills = computeTools.map(t => ({ id: 'xguard.compute.' + t.name, name: t.name.replaceAll('_', ' '), description: t.description, tags: ['compute', 'x402', 'paid-execution'], examples: [JSON.stringify({ action: 'xguard.compute.' + t.name, input: {} })], inputModes: ['application/json'], outputModes: ['application/json'], securityRequirements: [] }));
