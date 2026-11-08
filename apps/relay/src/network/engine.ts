import { SERVICES, operation } from './catalog.ts';
import { hostnameAllowed } from '../core/network-policy.js';
import { robotsAllows } from '../live/security.ts';
import { extractDocument } from '../outcome-engine.js';
import { hash } from '../live/util.ts';
export type Row = Record<string, any>;
export type FetchSource = (input: Row) => Promise<Row>;
export const fail = (code: string, status = 400): never => { throw Object.assign(new Error(code), { code, status }); };
export function publicUrl(raw: unknown): string {
  if (typeof raw !== 'string' || raw.length > 2048) return fail('invalid_public_url');
  let u: URL; try { u = new URL(raw); } catch { return fail('invalid_public_url'); }
  if (u.protocol !== 'https:' || u.port && u.port !== '443' || u.username || u.password || u.hash || !hostnameAllowed(u.hostname) || u.hostname.split('.').some(p => p.startsWith('xn--'))) return fail('invalid_public_url');
  return u.href;
}
const fields = (v: Row, names: string[]) => { if (Object.keys(v).some(k => !names.includes(k))) fail('unsupported_network_field'); };
const short = (v: unknown, max: number) => typeof v === 'string' && v.trim().length > 0 && v.length <= max;
export function normalizeNetwork(route: string, raw: Row): Row {
  const d = operation(route); if (!d || !raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_network_request');
  if (typeof raw.max_amount_atomic !== 'string' || !/^\d{1,12}$/.test(raw.max_amount_atomic) || BigInt(raw.max_amount_atomic) < BigInt(d.amount)) return fail('buyer_budget_too_small');
  const base: Row = { capability: d.id, max_amount_atomic: raw.max_amount_atomic };
  if (['route-resolve', 'route-compare'].includes(route)) {
    fields(raw, ['intent', 'country', 'max_amount_atomic']);
    if (!short(raw.intent, 2000) || raw.country !== undefined && !/^[A-Z]{2}$/.test(raw.country)) return fail('invalid_intent');
    return { ...base, intent: raw.intent.trim(), country: raw.country || null };
  }
  if (route === 'discover') {
    fields(raw, ['query', 'max_amount_atomic']); if (!short(raw.query, 200)) return fail('invalid_query');
    return { ...base, query: raw.query.trim() };
  }
  if (route === 'fact') {
    fields(raw, ['kind', 'identifier', 'max_amount_atomic']);
    if (raw.kind !== 'npm-version' || typeof raw.identifier !== 'string' || !/^(?:@[a-z0-9._-]+\/)?[a-z0-9][a-z0-9._-]{0,150}$/.test(raw.identifier)) return fail('unsupported_fact_kind');
    return { ...base, kind: raw.kind, identifier: raw.identifier };
  }
  if (['task', 'schedule'].includes(route)) {
    fields(raw, ['steps', 'budget_atomic', 'run_at', 'interval_seconds', 'runs', 'condition', 'max_amount_atomic']);
    if (typeof raw.budget_atomic !== 'string' || !/^\d{1,12}$/.test(raw.budget_atomic) || BigInt(raw.budget_atomic) < BigInt(d.amount)) return fail('task_budget_too_small');
    if (!Array.isArray(raw.steps) || !raw.steps.length || raw.steps.length > 3) return fail('invalid_task_steps');
    const steps = raw.steps.map((s: Row, i: number) => {
      if (!s || typeof s !== 'object' || Array.isArray(s)) return fail('invalid_task_step');
      fields(s, ['kind', 'url', 'fallback_url', 'expected_status', 'depends_on']);
      if (!['http', 'extract'].includes(s.kind) || s.expected_status !== undefined && (!Number.isInteger(s.expected_status) || s.expected_status < 200 || s.expected_status > 599)) return fail('invalid_task_step');
      if (s.depends_on !== undefined && (!Array.isArray(s.depends_on) || s.depends_on.some((n: any) => !Number.isInteger(n) || n < 0 || n >= i))) return fail('invalid_step_dependency');
      return { kind: s.kind, url: publicUrl(s.url), fallback_url: s.fallback_url === undefined ? null : publicUrl(s.fallback_url), expected_status: s.expected_status ?? 200, depends_on: s.depends_on ?? (i ? [i - 1] : []) };
    });
    if (route === 'task' && ['run_at', 'interval_seconds', 'runs', 'condition'].some(k => raw[k] !== undefined)) return fail('use_schedule_for_timing');
    const runAt = raw.run_at === undefined ? Date.now() : Date.parse(raw.run_at);
    if (!Number.isFinite(runAt) || runAt < Date.now() - 60000 || runAt > Date.now() + 30 * 86400000) return fail('invalid_schedule_time');
    if (raw.interval_seconds !== undefined && (!Number.isInteger(raw.interval_seconds) || raw.interval_seconds < 60 || raw.interval_seconds > 86400)) return fail('invalid_schedule_interval');
    const runs = raw.runs ?? 1;
    if (!Number.isInteger(runs) || runs < 1 || runs > 3 || runs > 1 && !raw.interval_seconds || steps.length * runs > 3) return fail('invalid_schedule_runs');
    if (raw.condition !== undefined && !['http_healthy'].includes(raw.condition)) return fail('unsupported_schedule_condition');
    return { ...base, steps, budget_atomic: raw.budget_atomic, run_at: raw.run_at ? new Date(runAt).toISOString() : null, interval_seconds: raw.interval_seconds ?? null, runs, condition: raw.condition ?? null };
  }
  fields(raw, ['url', 'expected_status', 'max_amount_atomic']);
  if (raw.expected_status !== undefined && (!Number.isInteger(raw.expected_status) || raw.expected_status < 200 || raw.expected_status > 599)) return fail('invalid_expected_status');
  return { ...base, url: publicUrl(raw.url), expected_status: raw.expected_status ?? 200 };
}
export function networkSchema(route: string): Row {
  const d = operation(route); if (!d) return {};
  const properties: Row = { max_amount_atomic: { type: 'string', pattern: '^\\d{1,12}$', description: 'Maximum authorized price in USDC atomic units; 6 decimals.' } };
  let required = ['max_amount_atomic'];
  const url = { type: 'string', format: 'uri', pattern: '^https://', maxLength: 2048 };
  if (['route-resolve', 'route-compare'].includes(route)) { properties.intent = { type: 'string', minLength: 1, maxLength: 2000 }; properties.country = { type: 'string', pattern: '^[A-Z]{2}$' }; required.push('intent'); }
  else if (route === 'discover') { properties.query = { type: 'string', minLength: 1, maxLength: 200 }; required.push('query'); }
  else if (route === 'fact') { properties.kind = { const: 'npm-version' }; properties.identifier = { type: 'string', maxLength: 180, pattern: '^(?:@[a-z0-9._-]+/)?[a-z0-9][a-z0-9._-]{0,150}$' }; required.push('kind', 'identifier'); }
  else if (['task', 'schedule'].includes(route)) {
    properties.steps = { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, required: ['kind', 'url'], properties: { kind: { enum: ['http', 'extract'] }, url, fallback_url: url, expected_status: { type: 'integer', minimum: 200, maximum: 599 }, depends_on: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 2 } } } } };
    properties.budget_atomic = { type: 'string', pattern: '^\\d{1,12}$' }; required.push('steps', 'budget_atomic');
    if (route === 'schedule') Object.assign(properties, { run_at: { type: 'string', format: 'date-time' }, interval_seconds: { type: 'integer', minimum: 60, maximum: 86400 }, runs: { type: 'integer', minimum: 1, maximum: 3 }, condition: { enum: ['http_healthy'] } });
  } else { properties.url = url; required.push('url'); properties.expected_status = { type: 'integer', minimum: 200, maximum: 599 }; }
  return { type: 'object', additionalProperties: false, required, properties };
}

export async function fetchPublic(url: string, fetcher: FetchSource): Promise<Row> {
  const checked = publicUrl(url), origin = new URL(checked).origin;
  const options = { method: 'GET', mode: 'text', max_bytes: 65536, timeout_ms: 8000, outcome: true, same_origin_only: true, max_age_seconds: 0 };
  const robots = await fetcher({ ...options, url: origin + '/robots.txt' });
  if (robots.status !== 404 && !robots.ok) return fail('robots_unavailable', 503);
  if (robots.status !== 404 && !robotsAllows(String(robots.data), new URL(checked).pathname + new URL(checked).search, 'xguard-web-fetch')) return fail('robots_disallowed', 403);
  // Restrict to the requested origin: redirects must not escape the robots policy.
  const result = await fetcher({ ...options, url: checked });
  if (new URL(result.final_url).origin !== origin) return fail('cross_origin_redirect', 422);
  return result;
}
const TERMS: [string, RegExp][] = [
  ['web-extraction', /crawl|extract|scrap|زحف|استخر|استخراج/iu], ['live-fact', /fact|version|حقيقة|حقائق|إصدار|نسخة/iu],
  ['http-verification', /verif|health|availability|تحقق|تأكد|فحص/iu], ['hosting', /deploy|hosting|نشر|استضاف/iu],
  ['database', /database|قاعدة|بيانات/iu], ['send-email', /email|بريد|إيميل/iu], ['build-store', /store|shop|متجر/iu],
  ['accept-payments-jordan', /payment|payoneer|jordan|دفع|الأردن|اردن|بايونير/iu], ['ai-image-generation', /image|صورة|صور/iu],
  ['translation', /translat|ترجم/iu],
];
export function matchServices(intent: string) {
  const terms = TERMS.filter(([, re]) => re.test(intent)).map(([cap]) => cap);
  const words = intent.toLowerCase().split(/[\s-]+/).filter(x => x.length > 2);
  return SERVICES.filter(s => terms.length ? s.capabilities.some(c => terms.includes(c)) : s.capabilities.some(c => words.some(w => c.includes(w))) || words.some(w => s.name.toLowerCase().includes(w))).slice(0, 6);
}
export async function resolveRoute(input: Row) {
  const selected = matchServices(input.intent);
  const id = 'xgroute_' + (await hash(JSON.stringify({ intent: input.intent, country: input.country }))).slice(0, 24);
  const steps = selected.map((s, i) => ({ step_id: i, service_id: s.id, capability_id: s.capabilities[0], url: s.docs, api_endpoint: s.endpoint,
    authentication: s.authentication, permission_required: s.executable ? 'x402-payment' : 'provider-account-and-explicit-action-authorization',
    provider_cost_atomic: s.executable ? '0' : null, xguard_cost_atomic: s.price_atomic, currency: s.executable ? 'USDC' : null,
    payment_method: s.executable ? 'x402:Base:USDC' : 'provider-dependent', geographic_availability: s.executable ? 'subject_to_applicable_restrictions' : 'requires_provider_verification',
    status: s.executable ? 'implemented_check_readiness_before_execution' : 'external_adapter_required', expected_latency_ms: null, rate_limit: null, quota_state: 'UNKNOWN',
    input_schema: s.id === 'xguard-extract' ? { urls: '1-3 public HTTPS URLs', max_amount_atomic: '12000' } : s.id === 'xguard-facts' ? networkSchema('fact') : s.id === 'xguard-verify' ? networkSchema('verify') : null,
    output_schema: s.executable ? { type: 'object', required: ['result', 'receipt', 'settlement'] } : null, verification_method: s.executable ? 'source digest and explicit status checks' : 'provider-specific integration required',
    fallback_service: selected.find(x => x.id !== s.id && x.capabilities.some(c => (s.capabilities as readonly string[]).includes(c)))?.id || null,
    dependencies: [], last_verified: null, current_health: 'UNKNOWN' }));
  const known = steps.filter(s => s.xguard_cost_atomic !== null);
  const base = { route_id: id, objective: input.intent, steps, country: input.country || null, provider_cost_known: steps.every(s => s.provider_cost_atomic !== null),
    known_xguard_cost_atomic: String(known.reduce((n, s) => n + Number(s.xguard_cost_atomic), 0)), estimated_total_cost_atomic: steps.length && steps.every(s => s.provider_cost_atomic !== null) ? String(known.reduce((n, s) => n + Number(s.xguard_cost_atomic), 0)) : null,
    expected_success_probability: null, estimated_time_ms: null, verification_state: 'CATALOG_PLAN_REVALIDATE_BEFORE_EXECUTION',
    executable: steps.length === 1 && steps.every(s => s.status.startsWith('implemented')), required_actions: steps.length ? steps.filter(s => s.status === 'external_adapter_required').map(s => `Connect and verify ${s.service_id}`) : ['No supported route matched. Supply a supported capability or register an adapter.'],
    scope: 'Curated catalog selection. Steps are capability candidates, not an inferred dependency DAG for arbitrary compound tasks. No measured success rate is available.', generated_at: new Date().toISOString() };
  const variants = ['CHEAPEST', 'FASTEST', 'HIGHEST_SUCCESS', 'RECOMMENDED'].map(strategy => ({ ...base, strategy, route_id: id + '_' + strategy.toLowerCase(), ranking: strategy === 'CHEAPEST' ? [...steps].sort((a,b) => Number(a.xguard_cost_atomic ?? Infinity) - Number(b.xguard_cost_atomic ?? Infinity)).map(s => s.service_id) : steps.map(s => s.service_id), ranking_evidence: strategy === 'CHEAPEST' ? 'Known XGuard prices only; unknown provider costs remain unknown.' : 'No measured provider latency or completion history; ranking is provisional.' }));
  return { ...base, routes: variants, recommended: variants[3].route_id };
}
export async function networkRpc(env: Row, taskId: string, action: string, body: Row) {
  if (!env.PAID_GATEWAY) return fail('durable_execution_unavailable', 503);
  const stub = env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName('network:' + taskId));
  const r = await stub.fetch('https://internal/network/' + action, { method: 'POST', body: JSON.stringify(body) });
  const data = await r.json(); if (!r.ok) return fail(data.error || 'task_state_unavailable', r.status); return data;
}
export async function refreshCapabilityGraph(env: Row, fetcher: FetchSource) {
  if (!env.PAID_GATEWAY || env.LIVE_NETWORK_DISCOVERY === 'off') return;
  const claim = await networkRpc(env, 'global-capability-graph-v1', 'graph-claim', {});
  for (const service of claim.services) {
    let record: Row;
    try {
      const r = await fetchPublic(service.docs, fetcher);
      record = { id: service.id, source_url: r.final_url, source_hash: r.body_sha256, retrieved_at: r.source.retrieved_at, http_status: r.status, verification: r.ok ? 'DOCUMENTATION_REACHABLE' : 'DOCUMENTATION_HTTP_ERROR', capability_verified: false, pricing_verified: false };
    } catch (e: any) { record = { id: service.id, source_url: service.docs, retrieved_at: new Date().toISOString(), verification: 'UNVERIFIED', error: e.code || 'source_unavailable', source_hash: null }; }
    await networkRpc(env, 'global-capability-graph-v1', 'graph-record', { record });
  }
}
export async function executeNetwork(input: Row, env: Row, fetcher: FetchSource, context: Row = {}): Promise<Row> {
  const start = Date.now(), d = operation(input.capability); if (!d) return fail('unsupported_network_operation');
  let data: Row;
  if (['network-resolve', 'network-compare'].includes(d.id)) data = await resolveRoute(input);
  else if (d.id === 'network-discover') {
    const candidates = matchServices(input.query).slice(0, 3);
    const services = [];
    for (const s of candidates) {
      try { const r = await fetchPublic(s.docs, fetcher); const record = { ...s, source_url: r.final_url, retrieved_at: r.source.retrieved_at, source_hash: r.body_sha256, verification: r.ok ? 'DOCUMENTATION_REACHABLE' : 'DOCUMENTATION_HTTP_ERROR', http_status: r.status, capability_verified: false, price_verified: false, geographic_eligibility_verified: false }; services.push(record); await networkRpc(env, 'global-capability-graph-v1', 'graph-record', { record }); }
      catch (e: any) { services.push({ ...s, verification: 'UNVERIFIED', error: e.code || 'source_unavailable', last_verified: null }); }
    }
    data = { query: input.query, services, scope: 'Curated catalog plus current documentation reachability; not a global search or provider execution test.' };
  } else if (d.id === 'network-platforms') {
    const origin = new URL(input.url).origin, resources = [];
    for (const path of ['/.well-known/agent-card.json', '/llms.txt', '/openapi.json']) {
      try { const r = await fetchPublic(origin + path, fetcher); const text = typeof r.data === 'string' ? r.data : JSON.stringify(r.data); resources.push({ url: r.final_url, status: r.status, digest: r.body_sha256, retrieved_at: r.source.retrieved_at, metadata: r.ok ? text.slice(0, 16000) : null, metadata_truncated: text.length > 16000, trust: 'UNTRUSTED_PROVIDER_DESCRIPTION' }); }
      catch (e: any) { resources.push({ url: origin + path, error: e.code || 'source_unavailable' }); }
    }
    data = { platform: origin, resources, verified_capability: false };
  } else if (d.id === 'network-fact') {
    const r = await fetchPublic('https://registry.npmjs.org/' + input.identifier + '/latest', fetcher);
    let value: Row; try { value = typeof r.data === 'string' ? JSON.parse(r.data) : r.data; } catch { return fail('source_schema_invalid', 422); }
    if (!r.ok || value.name !== input.identifier || typeof value.version !== 'string') return fail('source_schema_invalid', 422);
    data = { fact: value.version, identifier: input.identifier, source: r.final_url, retrieved_at: r.source.retrieved_at, last_verified: r.source.retrieved_at, freshness: 'CURRENT_SOURCE_RETRIEVAL', confidence: 'matches_primary_source_at_retrieval', verification_state: 'SOURCE_VERIFIED', source_sha256: r.body_sha256 };
  } else if (['network-task', 'network-schedule'].includes(d.id)) {
    if (!context.payment_identifier) return fail('settled_payment_context_required', 503);
    const taskId = 'xgtask_' + (await hash(context.payment_identifier)).slice(0, 32);
    data = await networkRpc(env, taskId, 'create', { input, task_id: taskId, payment_identifier: context.payment_identifier });
  } else {
    const r = await fetchPublic(input.url, fetcher);
    data = d.id === 'network-verify' ? { url: r.final_url, expected_status: input.expected_status, actual_status: r.status, verification_state: r.status === input.expected_status ? 'PASSED' : 'FAILED', verified_at: r.source.retrieved_at, source_sha256: r.body_sha256, scope: 'Current HTTP response only; no checkout, responsive layout or deployment ownership test.' }
      : { url: r.final_url, http_status: r.status, retrieved_at: r.source.retrieved_at, source_sha256: r.body_sha256, robots_checked: true, ...extractDocument(typeof r.data === 'string' ? r.data : JSON.stringify(r.data), r.final_url), verification_state: r.ok ? 'EXTRACTED' : 'SOURCE_HTTP_ERROR' };
  }
  data.billing = { operation_id: context.payment_identifier || null, service: d.id, provider_cost_atomic: '0', xguard_fee_atomic: d.amount, total_atomic: d.amount, currency: 'USDC', external_paid_provider_actions: false };
  const body = JSON.stringify(data); if (new TextEncoder().encode(body).length > 131072) return fail('network_result_too_large', 422);
  return { data, status: 200, final_url: 'https://api.xguardgate.com/api/paid/v1/' + d.route, body_sha256: await hash(body), body_bytes: new TextEncoder().encode(body).length, content_type: 'application/json', latency_ms: Date.now() - start, verification: { content_truth_verified: false, scope: 'Explicit checks in result' } };
}
