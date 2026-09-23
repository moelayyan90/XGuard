import { GOVERNANCE_DISCOVERY } from './core/governance.js';

export function describeGovernance(spec) {
  spec['x-governance'] = GOVERNANCE_DISCOVERY;
  const money = { type: 'string', pattern: '^(0|[1-9][0-9]{0,15})$', description: 'USD millionths as a decimal integer string; at most 1000000000000000.' };
  const forecast = { type: 'object', additionalProperties: false, properties: {
    request_digest: { type: 'string', pattern: '^[a-f0-9]{64}$' }, success_probability_bps: { type: 'integer', minimum: 0, maximum: 10000 },
    valid_until: { type: 'string', format: 'date-time', description: 'Future forecast expiry, at most one hour after provisioning.' },
    ...Object.fromEntries(['revenue_if_success', 'failure_loss', 'api_cost', 'compute_cost', 'payment_cost', 'slippage_cost', 'safety_buffer_cost'].map(k => [`${k}_usd_micros`, money])),
  } };
  forecast.required = Object.keys(forecast.properties);
  const policy = { type: 'object', additionalProperties: false, required: ['version', 'currency', 'minimum_net_usd_micros', 'daily_cost_limit_usd_micros', 'forecasts'], properties: {
    version: { type: 'integer', enum: [1] }, currency: { type: 'string', enum: ['USD'] }, minimum_net_usd_micros: money,
    daily_cost_limit_usd_micros: money, forecasts: { type: 'array', minItems: 1, maxItems: 32, items: forecast },
  } };
  const grant = spec.paths['/v1/egress/capabilities']?.post?.requestBody?.content?.['application/json']?.schema;
  if (grant?.properties) {
    grant.properties.governance = policy;
    grant.required = [...new Set([...(grant.required || []), 'governance'])];
  }
  const raw = { type: 'object', required: ['capability', 'target', 'idempotency_key'], additionalProperties: false, properties: {
    capability: { type: 'string' }, target: { type: 'string', format: 'uri' }, method: { type: 'string', enum: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    idempotency_key: { type: 'string', pattern: '^[A-Za-z0-9_:.-]{8,128}$' }, body_json: {},
    headers: { type: 'object', additionalProperties: { type: 'string' } }, governance_authorization: { type: 'string', maxLength: 16000 },
  } };
  const response = { description: 'Authorization, stored result, or structured rejection. No reusable provider keys.', content: { 'application/json': { schema: { type: 'object', additionalProperties: true } } } };
  for (const [path, summary, schema] of [
    ['/v1/egress/authorize', 'Authorize exact governed raw egress without executing or reserving funds', raw],
    ['/v1/egress/recover', 'Read a committed result without reserving, billing or resubmitting', raw],
    ['/v1/egress/halt', 'Permanently halt this authenticated governed capability', { type: 'object', required: ['capability'], properties: { capability: { type: 'string' } }, additionalProperties: false }],
    ['/v1/egress/governance-status', 'Read the authenticated durable governance state', { type: 'object', required: ['capability'], properties: { capability: { type: 'string' } }, additionalProperties: false }],
  ]) spec.paths[path] = { post: { summary, requestBody: { required: true, content: { 'application/json': { schema } } }, responses: Object.fromEntries(['200', '400', '401', '403', '404', '409', '410', '412', '423', '503'].map(status => [status, response])) } };
  const fetchSchema = spec.paths['/v1/egress/fetch']?.post?.requestBody?.content?.['application/json']?.schema;
  if (fetchSchema?.properties) fetchSchema.properties.governance_authorization = raw.properties.governance_authorization;
  // Raw results retain the existing upstream response contract and proof headers.
  spec.paths['/v1/egress/recover'].post.responses['200'] = { description: 'Original stored upstream bytes and X-XGuard-Proof; returns X-XGuard-Replay: true. Never dispatches.' };
  return spec;
}
