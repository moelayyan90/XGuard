import type { Env, Row } from './types.ts';
import { sourceSpec } from './adapters.ts';
import { hash, iso, rpc, shardName, shardOf } from './util.ts';

export const PAID_BASE = 'https://api.xguardgate.com/api/paid/v1';
export const LIVE_PAID = [
  { id: 'live-batch', route: 'batch', name: 'Evidence-backed fact bundle', amount: '10000', description: 'Retrieve up to 20 existing public facts in one attributed, timestamped, signed result. Missing facts are explicit; no new source fetches.', example: { facts: ['npm/react/latest-version', 'npm/typescript/latest-version'], max_amount_atomic: '10000' } },
  { id: 'live-history', route: 'history', name: 'Bounded historical export', amount: '20000', description: 'Export up to 300 stored observations of one fact in an explicit time range, with source hashes. No observations before collection began are invented.', example: { fact: 'npm/react/latest-version', from: '2026-10-01T00:00:00Z', to: '2026-10-19T00:00:00Z', limit: 300, max_amount_atomic: '20000' } },
  { id: 'live-compare', route: 'compare', name: 'Observed-value comparison', amount: '20000', description: 'Compare the last stored observation at or before each of two times. Reports observation times and evidence; unavailable historical values remain UNKNOWN.', example: { fact: 'npm/react/latest-version', from: '2026-10-01T00:00:00Z', to: '2026-10-19T00:00:00Z', max_amount_atomic: '20000' } },
] as const;
export function livePaidDefinition(id: string): any { return LIVE_PAID.find(d => d.id === id) || null; }
export function canonicalFact(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 300 || /[%?#\\\s]/.test(value)) return null;
  const parts = value.split('/'), key = parts.pop() || '';
  if (!/^[a-z0-9][a-z0-9-]{0,119}$/.test(key)) return null;
  try { const id = sourceSpec(parts[0] as any, parts.slice(1).join('/')).id; return `${id}/${key}` === value ? value : null; } catch { return null; }
}
function timestamp(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) || !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
export function normalizeLivePaid(route: string, raw: any): Row {
  const def = LIVE_PAID.find(d => d.route === route);
  const fail = (code: string): never => { throw Object.assign(new Error(code), { code, status: 400 }); };
  if (!def || !raw || typeof raw !== 'object' || Array.isArray(raw)) return fail('invalid_paid_request');
  const allowed = route === 'batch' ? ['facts', 'max_amount_atomic'] : ['fact', 'from', 'to', 'max_amount_atomic', ...(route === 'history' ? ['limit', 'cursor'] : [])];
  if (Object.keys(raw).some(k => !allowed.includes(k))) return fail('unsupported_paid_field');
  if (typeof raw.max_amount_atomic !== 'string' || !/^\d{1,12}$/.test(raw.max_amount_atomic) || BigInt(raw.max_amount_atomic) < BigInt(def.amount)) return fail('buyer_budget_too_small');
  const base = { capability: def.id, max_amount_atomic: raw.max_amount_atomic };
  if (route === 'batch') {
    if (!Array.isArray(raw.facts) || raw.facts.length < 1 || raw.facts.length > 20 || raw.facts.some((id: unknown) => !canonicalFact(id)) || new Set(raw.facts).size !== raw.facts.length) return fail('invalid_fact_bundle');
    return { ...base, facts: raw.facts };
  }
  const fact = canonicalFact(raw.fact), from = timestamp(raw.from), to = timestamp(raw.to);
  if (!fact || !from || !to || from > to) return fail('invalid_fact_time_range');
  if (route === 'history' && raw.limit !== undefined && (!Number.isInteger(raw.limit) || raw.limit < 1 || raw.limit > 300)) return fail('invalid_history_limit');
  let cursor = null;
  if (route === 'history' && raw.cursor != null) {
    if (typeof raw.cursor !== 'object' || Array.isArray(raw.cursor) || Object.keys(raw.cursor).some(k => !['observed_at', 'id'].includes(k)) || !timestamp(raw.cursor.observed_at) || typeof raw.cursor.id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(raw.cursor.id)) return fail('invalid_history_cursor');
    cursor = { observed_at: timestamp(raw.cursor.observed_at), id: raw.cursor.id };
  }
  return { ...base, fact, from, to, ...(route === 'history' ? { limit: raw.limit ?? 300, cursor } : {}) };
}
export function paidInputSchema(route: string): Row {
  const fact = { type: 'string', maxLength: 300, description: 'Canonical public fact ID, e.g. npm/react/latest-version; never an arbitrary URL.' };
  return { type: 'object', additionalProperties: false, required: route === 'batch' ? ['facts', 'max_amount_atomic'] : ['fact', 'from', 'to', 'max_amount_atomic'], properties: {
    max_amount_atomic: { type: 'string', pattern: '^\\d{1,12}$', description: 'Buyer-authorized maximum in 6-decimal USDC atomic units. No payment occurs merely by supplying a cap.' },
    ...(route === 'batch' ? { facts: { type: 'array', minItems: 1, maxItems: 20, uniqueItems: true, items: fact } } : { fact, from: { type: 'string', format: 'date-time' }, to: { type: 'string', format: 'date-time' }, ...(route === 'history' ? { limit: { type: 'integer', minimum: 1, maximum: 300, default: 300 }, cursor: { type: 'object', required: ['observed_at', 'id'], additionalProperties: false, properties: { observed_at: { type: 'string', format: 'date-time' }, id: { type: 'string', maxLength: 100 } } } } : {}) }),
  } };
}
export const paidResultSchema = { type: 'object', required: ['ok', 'result', 'receipt', 'settlement', 'proofrail'], properties: { ok: { const: true }, result: { type: 'object' }, receipt: { type: 'object' }, settlement: { type: 'object' }, proofrail: { type: 'object' } } };
export async function livePaidCapacity(env: Env, input: Row): Promise<void> {
  const id = input.facts?.[0] || input.fact, entity = id.slice(0, id.lastIndexOf('/'));
  const fact = await rpc(env.LIVE_SHARDS, shardName(shardOf(entity)), 'fact', { id });
  if (!fact) throw Object.assign(new Error('fact_not_published'), { code: 'fact_not_published', status: 404 });
}
export async function executeLivePaid(input: Row, env: Env): Promise<any> {
  const start = Date.now(), def = livePaidDefinition(input.capability);
  if (!def) throw new Error('unsupported_live_service');
  const ids: string[] = input.facts || [input.fact], groups = new Map<number, string[]>();
  for (const id of ids) { const shard = shardOf(id.slice(0, id.lastIndexOf('/'))); groups.set(shard, [...(groups.get(shard) || []), id]); }
  const results = await Promise.all([...groups].map(([shard, facts]) => rpc(env.LIVE_SHARDS, shardName(shard), 'paid-read', { kind: def.route, facts, from: input.from, to: input.to, limit: input.limit, cursor: input.cursor })));
  const rows = results.flat(), data: any = { service: def.id, generated_at: iso(), rows: ids.map(id => rows.find((r: any) => r.id === id)), scope: 'Stored primary-source observations; freshness labels and missing history are preserved. Source hashes prove byte identity, not independent source truth.' };
  const body = JSON.stringify(data), bytes = new TextEncoder().encode(body).length;
  if (bytes > 131072) throw Object.assign(new Error('paid_result_too_large'), { code: 'paid_result_too_large' });
  return { data, status: 200, final_url: `${PAID_BASE}/${def.route}`, body_sha256: await hash(body), body_bytes: bytes, content_type: 'application/json', latency_ms: Date.now() - start, verification: { content_truth_verified: false, source: 'XGuard Live stored evidence' } };
}
