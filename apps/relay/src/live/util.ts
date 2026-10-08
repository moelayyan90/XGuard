import { ORIGIN, SHARDS } from './types.ts';
import type { Json, Namespace } from './types.ts';

export function stable(value: Json): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  return `{${Object.keys(value).sort().map(k => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
}
export async function hash(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('');
}
export function shardOf(value: string): number {
  let result = 2166136261;
  for (const char of value) result = Math.imul(result ^ char.charCodeAt(0), 16777619);
  return (result >>> 0) % SHARDS;
}
export async function rpc(ns: Namespace, name: string, op: string, data: Record<string, any> = {}): Promise<any> {
  const response = await ns.get(ns.idFromName(name)).fetch(new Request('https://live.internal/rpc', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op, ...data }),
  }));
  const body = await response.json() as any;
  if (!response.ok) throw new Error(body.error || 'storage_unavailable');
  return body;
}
export const shardName = (id: number) => `catalog-v1-${id}`;
export const controlName = 'control-v1';
export const escape = (value: any) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!));
export const iso = (now = Date.now()) => new Date(now).toISOString();
export const valueText = (value: Json) => typeof value === 'string' ? value : stable(value);
export const json = (value: any, status = 200, headers: Record<string, string> = {}) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } });
export function integer(value: any, fallback: number, min = 0, max = 1000000): number {
  const n = Number(value ?? fallback); return Number.isSafeInteger(n) && n >= min && n <= max ? n : fallback;
}
export function negotiate(accept: string | null): 'html' | 'markdown' | 'json' | null {
  if (!accept) return 'html';
  const entries = accept.toLowerCase().split(',').map(part => {
    const [type, ...params] = part.trim().split(';');
    const q = params.find(x => x.trim().startsWith('q='));
    const quality = q ? Number(q.trim().slice(2)) : 1;
    return { type, quality: Number.isFinite(quality) && quality >= 0 && quality <= 1 ? quality : 0 };
  });
  const supported = [['html', 'text/html'], ['markdown', 'text/markdown'], ['json', 'application/json']] as const;
  const scores = supported.map(([format, mime], preference) => {
    const matches = entries.filter(x => x.type === mime || x.type === '*/*' || x.type === `${mime.split('/')[0]}/*`)
      .sort((a, b) => (b.type === mime ? 2 : b.type === '*/*' ? 0 : 1) - (a.type === mime ? 2 : a.type === '*/*' ? 0 : 1));
    return { format, quality: matches[0]?.quality ?? 0, preference };
  }).sort((a, b) => b.quality - a.quality || a.preference - b.preference);
  return scores[0].quality > 0 ? scores[0].format : null;
}
export function changeType(key: string, before: Json | undefined, after: Json): string {
  if (before === undefined) return 'added';
  if (after === null) return 'removed';
  if (before === null) return 'restored';
  if (/price/.test(key) && typeof before === 'number' && typeof after === 'number') return after > before ? 'price_increased' : 'price_decreased';
  if (/version|release/.test(key)) return 'released';
  if (/deprecat/.test(key)) return after === false ? 'restored' : 'deprecated';
  if (/status/.test(key)) return 'status_changed';
  if (/name/.test(key)) return 'renamed';
  return 'value_changed';
}
export function publicFact(row: Record<string, any>, now = Date.now()): Record<string, any> {
  const expired = now - Date.parse(row.verified_at) > row.max_age * 1000;
  const verification = row.verification === 'unknown' ? 'UNKNOWN' : row.verification === 'removed' ? 'REMOVED' : expired || row.verification === 'stale' ? 'STALE' : 'VERIFIED';
  const value = JSON.parse(row.value_json);
  return { id: row.id, entity: row.entity_id, entity_name: row.title, fact: row.fact_key, label: row.label,
    current_value: verification === 'VERIFIED' ? value : null, last_observed_value: value,
    normalized_value: verification === 'VERIFIED' ? value : null, unit: row.unit || null, value_type: row.value_type,
    previous_value: row.previous_json == null ? null : JSON.parse(row.previous_json), observed_at: row.observed_at, first_observed_at: row.first_observed_at,
    verified_at: row.verified_at, valid_from: row.valid_from, changed_at: row.changed_at, change_type: row.change_type,
    source_url: row.source_url, source_domain: row.domain, source_type: row.source_type, retrieval_method: row.method,
    source_hash: row.source_hash, verification, confidence: verification === 'VERIFIED' ? 'source-verified' : 'unconfirmed-current-value',
    confidence_scope: 'Matches the cited primary source; not an independent audit of its claims.',
    canonical_url: `${ORIGIN}/fact/${row.entity_id}/${row.fact_key}`, history_url: `${ORIGIN}/history/${row.entity_id}/${row.fact_key}`,
    evidence_url: `${ORIGIN}/evidence/${row.entity_id}/${row.observation_id}`, max_age_seconds: row.max_age,
  };
}
// Aggregate pages may reuse an explicitly dated snapshot. A cached observation
// must still lose its current value as soon as its freshness window expires.
export function agePublicFact(fact: Record<string, any>, now = Date.now()): Record<string, any> {
  if (fact.verification !== 'VERIFIED' || now - Date.parse(fact.verified_at) <= fact.max_age_seconds * 1000) return fact;
  return { ...fact, current_value: null, normalized_value: null, verification: 'STALE', confidence: 'unconfirmed-current-value' };
}
export function isRequestQuotaError(error: unknown): boolean {
  return /Exceeded allowed volume of requests in Durable Objects free tier|storage_request_quota_exhausted/.test(String(error));
}
export function retryDelay(failures: number, interval: number, retryAfter: string | null = null, now = Date.now()): number {
  const parsed = retryAfter == null ? 0 : /^\d+$/.test(retryAfter) ? Number(retryAfter) * 1000 : Math.max(0, Date.parse(retryAfter) - now);
  const backoff = Math.min(86400000, Math.max(60000, interval * 1000) * 2 ** Math.min(failures, 8));
  return Math.max(Number.isFinite(parsed) ? parsed : 0, Math.floor(backoff * (1 + Math.random() * .15)));
}
