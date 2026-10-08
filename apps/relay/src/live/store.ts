import { SCHEMA, SCHEMA_VERSION } from './schema.ts';
import { TOPICS } from './types.ts';
import type { Json, ObservationInput, Row, SourceSpec, Storage } from './types.ts';
import { changeType, iso, publicFact, stable } from './util.ts';

const FACT_SELECT = `SELECT d.*,e.title,e.topic,e.suppressed,(SELECT min(h.observed_at) FROM fact_observations h WHERE h.fact_id=d.id) AS first_observed_at,c.observation_id,c.value_json,c.previous_json,c.verified_at,c.changed_at,c.change_type,c.verification,
 o.observed_at,o.valid_from,v.source_url,v.source_domain AS domain,v.source_type,v.source_hash,v.method
 FROM fact_definitions d JOIN entities e ON e.id=d.entity_id JOIN current_facts c ON c.id=d.id
 JOIN fact_observations o ON o.id=c.observation_id JOIN evidence v ON v.id=o.evidence_id`;
export class Store {
  storage: Storage;
  constructor(storage: Storage) {
    this.storage = storage;
    const initialized = this.one("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_versions'");
    if (initialized && this.one('SELECT version FROM schema_versions WHERE version=?', SCHEMA_VERSION)) return;
    storage.transactionSync(() => {
      for (const sql of SCHEMA) storage.sql.exec(sql);
      storage.sql.exec('INSERT OR IGNORE INTO schema_versions VALUES(?,?)', SCHEMA_VERSION, iso());
      for (const [id, title] of Object.entries(TOPICS)) storage.sql.exec('INSERT OR IGNORE INTO topics VALUES(?,?)', id, title);
    });
  }
  rows(sql: string, ...values: any[]): Row[] { return this.storage.sql.exec(sql, ...values).toArray(); }
  one(sql: string, ...values: any[]): Row | null { return this.rows(sql, ...values)[0] || null; }
  run(sql: string, ...values: any[]): void { this.storage.sql.exec(sql, ...values); }
  get(key: string, fallback: any = null): any { const row = this.one('SELECT value FROM settings WHERE key=?', key); return row ? JSON.parse(row.value) : fallback; }
  set(key: string, value: any): void { this.run('INSERT INTO settings VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', key, JSON.stringify(value)); }
  audit(action: string, detail: any, actor = 'system'): void { this.run('INSERT INTO audit_log VALUES(?,?,?,?,?)', crypto.randomUUID(), iso(), actor, action, JSON.stringify(detail)); }
  enqueue(spec: SourceSpec, provenance = 'curated-primary-source'): boolean {
    if (this.one('SELECT id FROM sources WHERE id=?', spec.id)) return false;
    this.storage.transactionSync(() => {
      this.run('INSERT INTO discovery_candidates(id,spec_json,provenance,created_at) VALUES(?,?,?,?)', spec.id, JSON.stringify(spec), provenance, iso());
      this.run('INSERT INTO sources(id,spec_json,domain,last_interval) VALUES(?,?,?,?)', spec.id, JSON.stringify(spec), spec.domain, spec.interval);
    }); return true;
  }
  claimDue(now = Date.now()): Row | null {
    return this.storage.transactionSync(() => {
      const source = this.one('SELECT * FROM sources WHERE enabled=1 AND next_fetch<=? AND lease_until<? AND COALESCE((SELECT until_ms FROM domain_leases WHERE domain=sources.domain),0)<=? ORDER BY (last_interval<=600) DESC,next_fetch,id LIMIT 1', now, now, now);
      if (source) this.run('UPDATE sources SET lease_until=? WHERE id=?', now + 120000, source.id);
      return source;
    });
  }
  nextDue(): number | null { return this.one('SELECT min(max(next_fetch,lease_until,COALESCE((SELECT until_ms FROM domain_leases WHERE domain=sources.domain),0))) AS next FROM sources WHERE enabled=1')?.next ?? null; }
  fetchLog(source: Row, id: string, status: number | null, bytes: number, latency: number, digest: string | null, error: string | null): void {
    this.run('INSERT INTO source_fetches VALUES(?,?,?,?,?,?,?,?,?)', id, source.id, iso(), status, Math.round(latency), bytes, digest, error, 'conditional-https');
  }
  defer(id: string, delay: number): void { this.run('UPDATE sources SET lease_until=0,next_fetch=? WHERE id=?', Date.now() + delay, id); }
  deferDomain(domain: string, delay: number): void {
    this.run('INSERT INTO domain_leases VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET until_ms=max(until_ms,excluded.until_ms)', domain, 'local-backoff', Date.now() + delay);
  }
  failed(source: Row, error: string, delay: number): void {
    this.storage.transactionSync(() => {
      this.run('UPDATE sources SET failures=failures+1,last_error=?,lease_until=0,next_fetch=? WHERE id=?', error, Date.now() + delay, source.id);
      this.run("UPDATE current_facts SET verification='stale' WHERE id IN (SELECT id FROM fact_definitions WHERE entity_id=?) AND verification='verified'", source.id);
      this.run('INSERT INTO source_reliability VALUES(?,0,1,0) ON CONFLICT(source_id) DO UPDATE SET failures=failures+1', source.id);
      this.run('UPDATE discovery_candidates SET error=? WHERE id=?', error, source.id);
    });
  }
  revalidated(source: Row, observedAt: string, next: number): void {
    if (!source.last_hash || !this.one('SELECT id FROM current_facts WHERE id IN (SELECT id FROM fact_definitions WHERE entity_id=?) LIMIT 1', source.id)) throw new Error('304_without_verified_observation');
    this.storage.transactionSync(() => {
      this.run("UPDATE current_facts SET verified_at=?,verification=CASE WHEN verification='removed' THEN 'removed' ELSE 'verified' END WHERE id IN (SELECT id FROM fact_definitions WHERE entity_id=?)", observedAt, source.id);
      this.run('UPDATE sources SET failures=0,last_error=NULL,last_success=?,next_fetch=?,lease_until=0 WHERE id=?', observedAt, next, source.id);
      this.run('INSERT INTO source_reliability VALUES(?,1,0,0) ON CONFLICT(source_id) DO UPDATE SET successes=successes+1', source.id);
    });
  }
  observe(input: ObservationInput, nextFetch: number): number {
    const { spec, observedAt, hash: sourceHash, fetchId, method } = input;
    if (!/^[0-9a-f]{64}$/.test(sourceHash) || !Number.isFinite(Date.parse(observedAt)) || !input.facts.length || input.facts.length > 250) throw new Error('invalid_observation');
    const seen = new Set<string>();
    for (const fact of input.facts) {
      if (!/^[a-z0-9][a-z0-9-]{0,149}$/.test(fact.key) || seen.has(fact.key) || !fact.label || fact.label.length > 200 || stable(fact.value).length > 8192 || (typeof fact.value === 'number' && !Number.isFinite(fact.value))) throw new Error('invalid_fact');
      seen.add(fact.key);
    }
    return this.storage.transactionSync(() => {
      this.run('INSERT INTO entities(id,title,topic,published,created_at,updated_at) VALUES(?,?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,topic=excluded.topic,published=1,updated_at=excluded.updated_at', spec.id, spec.title, spec.topic, observedAt, observedAt);
      let changed = 0;
      const facts = [...input.facts];
      if (input.exhaustive) {
        for (const old of this.rows('SELECT d.fact_key,d.label,c.value_json FROM fact_definitions d JOIN current_facts c ON c.id=d.id WHERE d.entity_id=?', spec.id)) {
          if (!seen.has(old.fact_key) && old.value_json !== 'null') facts.push({ key: old.fact_key, label: old.label, value: null });
        }
      }
      const evidenceId = crypto.randomUUID();
      this.run('INSERT INTO evidence VALUES(?,?,?,?,?,?,?,?,?)', evidenceId, sourceHash, spec.url, spec.domain, spec.sourceType, observedAt, method, fetchId,
        stable(Object.fromEntries(input.facts.map(x => [x.key, x.value]))));
      for (const fact of facts) {
        const id = `${spec.id}/${fact.key}`, value = stable(fact.value), previous = this.one('SELECT * FROM current_facts WHERE id=?', id);
        const didChange = !previous || previous.value_json !== value;
        const kind = didChange ? changeType(fact.key, previous ? JSON.parse(previous.value_json) : undefined, fact.value) : previous.change_type;
        const observationId = crypto.randomUUID();
        this.run('INSERT INTO fact_definitions VALUES(?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET label=excluded.label,value_type=excluded.value_type,unit=excluded.unit,max_age=excluded.max_age',
          id, spec.id, fact.key, fact.label, fact.valueType || typeof fact.value, fact.unit || '', spec.maxAge);
        this.run('INSERT INTO fact_observations VALUES(?,?,?,?,?,?,?)', observationId, id, value, observedAt, didChange ? observedAt : previous.changed_at, fact.value === null ? 'removed' : 'verified', evidenceId);
        this.run('INSERT INTO current_facts VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET observation_id=excluded.observation_id,value_json=excluded.value_json,previous_json=excluded.previous_json,verified_at=excluded.verified_at,changed_at=excluded.changed_at,change_type=excluded.change_type,verification=excluded.verification',
          id, observationId, value, didChange ? previous?.value_json ?? null : previous.previous_json, observedAt, didChange ? observedAt : previous.changed_at, kind, fact.value === null ? 'removed' : 'verified');
        if (didChange) {
          changed++;
          this.run('INSERT INTO fact_changes VALUES(?,?,?,?,?,?,?,?)', observationId, id, spec.id, previous?.value_json ?? null, value, observedAt, kind, observationId);
        }
      }
      for (const related of input.related || []) this.run('INSERT OR IGNORE INTO entity_relationships VALUES(?,?,?)', spec.id, related, 'declared-dependency');
      this.run('UPDATE sources SET last_hash=?,etag=?,last_modified=?,last_success=?,failures=0,last_error=NULL,lease_until=0,next_fetch=? WHERE id=?',
        sourceHash, input.etag || null, input.lastModified || null, observedAt, nextFetch, spec.id);
      this.run("UPDATE discovery_candidates SET status='published',error=NULL WHERE id=?", spec.id);
      this.run('INSERT INTO source_reliability VALUES(?,1,0,?) ON CONFLICT(source_id) DO UPDATE SET successes=successes+1,changes=changes+excluded.changes', spec.id, changed);
      return changed;
    });
  }
  entity(id: string): any {
    const entity = this.one('SELECT * FROM entities WHERE id=? AND published=1 AND suppressed=0', id);
    if (!entity) return null;
    return { ...entity, facts: this.rows(`${FACT_SELECT} WHERE d.entity_id=? ORDER BY d.fact_key`, id).map(x => publicFact(x)),
      related: this.rows('SELECT related_id FROM entity_relationships WHERE parent_id=? LIMIT 20', id).map(x => x.related_id) };
  }
  fact(id: string): any { const row = this.one(`${FACT_SELECT} WHERE d.id=? AND e.published=1 AND e.suppressed=0`, id); return row ? publicFact(row) : null; }
  history(id: string, page: number): any[] {
    return this.rows('SELECT o.*,v.source_url,v.source_hash,v.method FROM fact_observations o JOIN evidence v ON v.id=o.evidence_id JOIN fact_definitions d ON d.id=o.fact_id JOIN entities e ON e.id=d.entity_id WHERE o.fact_id=? AND e.suppressed=0 ORDER BY o.observed_at DESC,o.id DESC LIMIT 100 OFFSET ?', id, (page - 1) * 100)
      .map(x => ({ ...x, value: JSON.parse(x.value_json), value_json: undefined }));
  }
  evidence(entity: string, observation: string): any {
    return this.one('SELECT v.*,o.fact_id,o.value_json,o.observed_at,o.verification FROM evidence v JOIN fact_observations o ON o.evidence_id=v.id JOIN fact_definitions d ON d.id=o.fact_id JOIN entities e ON e.id=d.entity_id WHERE o.id=? AND d.entity_id=? AND e.suppressed=0', observation, entity);
  }
  changes(entity: string | null = null, id: string | null = null, page = 1): any[] {
    let where = 'WHERE e.suppressed=0'; const args: any[] = [];
    if (entity) { where += ' AND c.entity_id=?'; args.push(entity); }
    if (id) { where += ' AND c.id=?'; args.push(id); }
    return this.rows(`SELECT c.*,d.label,v.source_url,v.source_hash FROM fact_changes c JOIN fact_definitions d ON d.id=c.fact_id JOIN entities e ON e.id=c.entity_id JOIN fact_observations o ON o.id=c.observation_id JOIN evidence v ON v.id=o.evidence_id ${where} ORDER BY c.observed_at DESC,c.id DESC LIMIT 100 OFFSET ?`, ...args, (page - 1) * 100).map(x => ({ ...x, previous_value: x.previous_json == null ? null : JSON.parse(x.previous_json), current_value: JSON.parse(x.value_json), previous_json: undefined, value_json: undefined }));
  }
  list(topic: string | null, page = 1, size = 100): Row[] {
    return this.rows(`SELECT e.id,e.title,e.topic,e.updated_at,count(d.id) AS facts FROM entities e JOIN fact_definitions d ON d.entity_id=e.id WHERE e.published=1 AND e.suppressed=0 ${topic ? 'AND e.topic=?' : ''} GROUP BY e.id ORDER BY e.id LIMIT ? OFFSET ?`, ...topic ? [topic, size, (page - 1) * size] : [size, (page - 1) * size]);
  }
  sitemap(offset: number, size = 1000): Row[] {
    return this.rows(`SELECT d.id,d.entity_id,c.changed_at AS modified FROM fact_definitions d JOIN current_facts c ON c.id=d.id JOIN entities e ON e.id=d.entity_id WHERE e.suppressed=0 AND e.published=1 AND c.verification!='removed' ORDER BY d.id LIMIT ? OFFSET ?`, size, offset);
  }
  stats(): any {
    const now = iso(), start = now.slice(0, 10), cutoff = iso(Date.now() - 86400000);
    return {
      ...this.one(`SELECT count(*) AS facts,COALESCE(sum(CASE WHEN c.verification='verified' AND (julianday(?) - julianday(c.verified_at))*86400<=d.max_age THEN 1 ELSE 0 END),0) AS verified,COALESCE(sum(CASE WHEN c.verification='stale' OR (julianday(?) - julianday(c.verified_at))*86400>d.max_age THEN 1 ELSE 0 END),0) AS stale,max(c.verified_at) AS last_update FROM current_facts c JOIN fact_definitions d ON d.id=c.id JOIN entities e ON e.id=d.entity_id WHERE e.published=1 AND e.suppressed=0`, now, now),
      entities: this.one('SELECT count(*) AS n FROM entities WHERE published=1 AND suppressed=0')!.n,
      sources: this.one('SELECT count(*) AS n FROM sources')!.n,
      changes_today: this.one('SELECT count(*) AS n FROM fact_changes WHERE observed_at>=?', start)!.n,
      fetch_errors: this.one('SELECT count(*) AS n FROM sources WHERE last_error IS NOT NULL')!.n,
      pending: this.one("SELECT count(*) AS n FROM discovery_candidates WHERE status='pending'")!.n,
      due: this.one('SELECT count(*) AS n FROM sources WHERE enabled=1 AND next_fetch<?', Date.now())!.n,
      fetches_24h: this.one('SELECT count(*) AS n FROM source_fetches WHERE observed_at>=?', cutoff)!.n,
      last_tick: this.get('last-tick'), schema_version: SCHEMA_VERSION,
    };
  }
  publicSummary(): any {
    const items = this.list(null, 1, 4);
    const examples = items.slice(0, 2).map(item => { const facts = this.entity(item.id)?.facts || []; return facts.find((fact: any) => /latest-version|service-status|latest-release/.test(fact.fact)) || facts[0]; }).filter(Boolean);
    return { stats: this.stats(), items, examples, changes: this.changes(), topics: this.rows('SELECT topic,count(*) AS count FROM entities WHERE published=1 AND suppressed=0 GROUP BY topic') };
  }
  telemetry(event: Row): void {
    const day = event.timestamp.slice(0, 10);
    this.storage.transactionSync(() => {
      this.run('INSERT INTO crawler_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)', event.id, event.timestamp, event.path, event.status, event.content_type, event.cache, event.classification, event.operator || '', event.user_agent, event.referrer || '', event.country || '', event.bytes, event.latency_ms, event.visitor_hash || '', event.synthetic ? 1 : 0);
      if (event.synthetic) return;
      this.run(`INSERT INTO request_metrics VALUES(?,?,?,?,?,?,1,?,?) ON CONFLICT(day,path,operator,classification,status,cache) DO UPDATE SET requests=requests+1,bytes=bytes+excluded.bytes,latency_ms=latency_ms+excluded.latency_ms`, day, event.path, event.operator || '', event.classification, event.status, event.cache, event.bytes, event.latency_ms);
      if (event.visitor_hash && event.classification === 'verified-ai') this.run('INSERT INTO crawler_visitors VALUES(?,?,?,1) ON CONFLICT(day,visitor_hash,operator) DO UPDATE SET requests=requests+1', day, event.visitor_hash, event.operator || '');
      if (event.referral_platform && event.classification === 'unclassified') this.run('INSERT INTO ai_referrals VALUES(?,?,?,1) ON CONFLICT(day,path,platform) DO UPDATE SET requests=requests+1', day, event.path, event.referral_platform);
    });
  }
  metrics(): any {
    return { requests: this.rows('SELECT day,classification,operator,status,cache,sum(requests) AS requests,sum(bytes) AS bytes FROM request_metrics WHERE day>=? GROUP BY day,classification,operator,status,cache ORDER BY day DESC', iso(Date.now() - 30 * 86400000).slice(0, 10)),
      top_pages: this.rows("SELECT path,sum(requests) AS requests FROM request_metrics WHERE day>=? AND classification='verified-ai' GROUP BY path ORDER BY requests DESC LIMIT 20", iso(Date.now() - 7 * 86400000).slice(0, 10)),
      repeat: this.one('SELECT count(*) AS crawlers,COALESCE(sum(CASE WHEN requests>1 THEN 1 ELSE 0 END),0) AS repeat_crawlers FROM crawler_visitors WHERE day=?', iso().slice(0, 10)),
      referrals: this.rows('SELECT platform,sum(requests) AS requests FROM ai_referrals WHERE day>=? GROUP BY platform', iso(Date.now() - 7 * 86400000).slice(0, 10)) };
  }
  cleanOperationalData(): void {
    this.run('DELETE FROM crawler_requests WHERE timestamp<?', iso(Date.now() - 7 * 86400000));
    this.run('DELETE FROM crawler_visitors WHERE day<?', iso(Date.now() - 31 * 86400000).slice(0, 10));
    this.run('DELETE FROM rate_limits WHERE expires<?', Date.now());
  }
  limit(key: string, max: number, windowMs: number): boolean {
    return this.storage.transactionSync(() => {
      const now = Date.now(), row = this.one('SELECT * FROM rate_limits WHERE key=?', key);
      if (row && row.expires > now && row.count >= max) return false;
      this.run('INSERT INTO rate_limits VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires>? THEN count+1 ELSE 1 END,expires=CASE WHEN expires>? THEN expires ELSE excluded.expires END', key, now + windowMs, now, now); return true;
    });
  }
}
