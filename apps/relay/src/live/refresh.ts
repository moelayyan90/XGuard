import type { Env, Row } from './types.ts';
import { parseSource, sourceSpec } from './adapters.ts';
import { boundedBody, checkRobots, safeFetch } from './security.ts';
import { controlName, hash, iso, retryDelay, rpc } from './util.ts';
import { Store } from './store.ts';

export function refreshInterval(source: Row, reliability: Row | null, demand = 0): number {
  const spec = JSON.parse(source.spec_json);
  const changes = Number(reliability?.changes || 0), checks = Math.max(1, Number(reliability?.successes || 1));
  const factor = changes / checks > .25 || demand > 100 ? .5 : checks > 20 && changes < 2 ? 2 : 1;
  return Math.min(spec.maxAge / 2, Math.max(spec.adapter === 'status' ? 300 : 3600, spec.interval * factor));
}
export async function refreshOne(store: Store, env: Env, source: Row): Promise<void> {
  const spec = sourceSpec(JSON.parse(source.spec_json).adapter, JSON.parse(source.spec_json).identifier);
  const lease = await rpc(env.LIVE_CONTROL, controlName, 'source-lease', { domain: spec.domain });
  if (!lease.token) { store.defer(source.id, lease.retry_after_ms + Math.random() * 15000); return; }
  const fetchId = crypto.randomUUID(), started = performance.now(); let status: number | null = null, retryAfter: string | null = null;
  try {
    await checkRobots(spec.url, env);
    const headers: Record<string, string> = {};
    if (source.etag) headers['if-none-match'] = source.etag;
    if (source.last_modified) headers['if-modified-since'] = source.last_modified;
    const response = await safeFetch(spec.url, headers); status = response.status; retryAfter = response.headers.get('retry-after');
    const verified = iso();
    const recentDemand = store.one('SELECT sum(requests) AS n FROM request_metrics WHERE path=? AND day>=?', `/live/${spec.id}`, iso(Date.now() - 86400000).slice(0, 10))?.n || 0;
    const interval = refreshInterval(source, store.one('SELECT * FROM source_reliability WHERE source_id=?', spec.id), recentDemand);
    const next = Date.now() + Math.floor(interval * 1000 * (.9 + Math.random() * .1));
    if (status === 304) {
      store.revalidated(source, verified, next); store.fetchLog(source, fetchId, status, 0, performance.now() - started, source.last_hash, null); return;
    }
    if (!response.ok) { await response.body?.cancel(); throw new Error(`source_http_${status}`); }
    const body = await boundedBody(response);
    const parsed = parseSource(spec, body), digest = await hash(body);
    store.observe({ spec, facts: parsed.facts, observedAt: verified, hash: digest, fetchId, method: 'conditional-https',
      etag: response.headers.get('etag') || undefined, lastModified: response.headers.get('last-modified') || undefined,
      related: parsed.related, exhaustive: parsed.exhaustive }, next);
    store.fetchLog(source, fetchId, status, new TextEncoder().encode(body).length, performance.now() - started, digest, null);
    store.run('UPDATE sources SET last_interval=? WHERE id=?', interval, spec.id);
    console.log(JSON.stringify({ event: 'source_refreshed', source: spec.id, facts: parsed.facts.length, bytes: body.length, status }));
  } catch (error) {
    const code = error instanceof Error ? error.message.slice(0, 160) : 'fetch_failed';
    const delay = retryDelay(source.failures, spec.interval, retryAfter);
    store.failed(source, code, delay); store.fetchLog(source, fetchId, status, 0, performance.now() - started, null, code);
    console.warn(JSON.stringify({ event: 'source_fetch_failed', source: spec.id, code, retry_ms: delay }));
    if (status === 429 || status === 403) await rpc(env.LIVE_CONTROL, controlName, 'source-cooldown', { domain: spec.domain, until: Date.now() + delay });
  } finally {
    await rpc(env.LIVE_CONTROL, controlName, 'source-release', { domain: spec.domain, token: lease.token });
  }
}
