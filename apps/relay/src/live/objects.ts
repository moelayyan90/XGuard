import { Store } from './store.ts';
import { refreshOne } from './refresh.ts';
import { sourceSpec } from './adapters.ts';
import { SOURCE_HOSTS } from './security.ts';
import { iso, json, integer, rpc, shardName, isRequestQuotaError } from './util.ts';
import { SHARDS } from './types.ts';
import type { Env, Row, State } from './types.ts';

export class LiveShard {
  state: State; env: Env; store: Store; running = false;
  constructor(state: State, env: Env) { this.state = state; this.env = env; this.store = new Store(state.storage); }
  async wake(urgent = false): Promise<void> {
    if (this.env.LIVE_SOURCE_FETCHES === 'off') return;
    const next = this.store.nextDue();
    const last = Date.parse(this.store.get('last-tick') || '') || 0;
    // Alarm invocations also consume the provider request quota. Bound automatic
    // work even when thousands of sources compete for one upstream domain lease.
    if (next !== null) await this.state.storage.setAlarm(Math.max(Date.now() + 1000 + Math.random() * 10000, next, urgent ? 0 : last + 600000));
  }
  async alarm(): Promise<void> {
    if (this.running || this.env.LIVE_SOURCE_FETCHES === 'off') return;
    this.running = true;
    try {
      this.store.set('last-tick', iso());
      for (let i = 0; i < 2; i++) {
        const source = this.store.claimDue(); if (!source) break;
        await refreshOne(this.store, this.env, source);
      }
      if (this.store.get('cleanup-day') !== iso().slice(0, 10)) { this.store.cleanOperationalData(); this.store.set('cleanup-day', iso().slice(0, 10)); }
    } finally { this.running = false; await this.wake(); }
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as Row;
      const { op } = body;
      if (op === 'seed') {
        let queued = 0;
        for (const input of (body.sources || []).slice(0, 1500)) if (this.store.enqueue(sourceSpec(input.adapter, input.identifier), body.provenance)) queued++;
        await this.wake(); return json({ queued });
      }
      if (op === 'tick') { this.store.set('cron-seen', iso()); await this.wake(); return json({ scheduled: true }); }
      if (op === 'entity') return json(this.store.entity(body.id));
      if (op === 'entity-page') { const entity = this.store.entity(body.id); return json(entity ? { ...entity, changes: this.store.changes(body.id).slice(0, 8) } : null); }
      if (op === 'fact') return json(this.store.fact(body.id));
      if (op === 'fact-page') { const fact = this.store.fact(body.id); return json(fact ? { fact, history: this.store.history(body.id, 1).slice(0, 10) } : null); }
      if (op === 'history') return json(this.store.history(body.id, integer(body.page, 1, 1, 1000000)));
      if (op === 'evidence') return json(this.store.evidence(body.entity, body.observation));
      if (op === 'changes') return json(this.store.changes(body.entity, body.id, integer(body.page, 1, 1, 1000000)));
      if (op === 'list') return json(this.store.list(body.topic || null, integer(body.page, 1, 1, 1000000), integer(body.size, 100, 1, 1000)));
      if (op === 'search') {
        const term = '%' + String(body.q || '').slice(0, 100).replace(/[\\%_]/g, '\\$&') + '%';
        return json(this.store.rows("SELECT e.id,e.title,e.topic,e.updated_at,count(d.id) AS facts FROM entities e JOIN fact_definitions d ON d.entity_id=e.id WHERE e.published=1 AND e.suppressed=0 AND (e.title LIKE ? ESCAPE '\\' OR e.id LIKE ? ESCAPE '\\') GROUP BY e.id ORDER BY e.id LIMIT 50", term, term));
      }
      if (op === 'sitemap') return json(this.store.sitemap(integer(body.offset, 0), 1000));
      if (op === 'stats') return json(this.store.stats());
      if (op === 'summary') return json(this.store.publicSummary());
      if (op === 'topic-counts') return json(this.store.rows('SELECT topic,count(*) AS count FROM entities WHERE published=1 AND suppressed=0 GROUP BY topic'));
      if (op === 'metrics') return json(this.store.metrics());
      if (op === 'growth-candidates') {
        const demand = this.store.rows("SELECT path,sum(requests) AS requests FROM request_metrics WHERE day>=? AND status=200 AND classification IN ('verified-ai','unclassified') GROUP BY path HAVING sum(requests)>=3 ORDER BY requests DESC LIMIT 20", iso(Date.now() - 7 * 86400000).slice(0, 10));
        const candidates: Row[] = [];
        for (const row of demand) {
          const parts = row.path.split('/');
          if (!['live', 'fact', 'history'].includes(parts[1])) continue;
          const parent = parts.slice(2, parts[1] === 'live' ? undefined : -1).join('/');
          for (const relation of this.store.rows('SELECT related_id FROM entity_relationships WHERE parent_id=? LIMIT 5', parent)) {
            candidates.push({ id: relation.related_id, parent, requests: row.requests });
          }
        }
        return json(candidates.slice(0, 30));
      }
      if (op === 'telemetry') { this.store.telemetry(body.event); return json({ ok: true }); }
      if (op === 'sources') return json(this.store.rows('SELECT id,domain,enabled,failures,last_error,last_success,next_fetch,last_interval FROM sources ORDER BY failures DESC,id LIMIT 200'));
      if (op === 'refresh') {
        if (!this.store.one('SELECT id FROM sources WHERE id=?', body.id)) return json({ error: 'source_not_found' }, 404);
        this.store.run('UPDATE sources SET next_fetch=0 WHERE id=? AND enabled=1', body.id); this.store.audit('manual-refresh', { id: body.id }, 'owner'); await this.wake(true); return json({ queued: true });
      }
      if (op === 'source-enabled') {
        this.store.run('UPDATE sources SET enabled=? WHERE id=?', body.enabled ? 1 : 0, body.id); this.store.audit('source-enabled', { id: body.id, enabled: body.enabled }, 'owner'); await this.wake(); return json({ ok: true });
      }
      if (op === 'suppress') {
        this.store.run('UPDATE entities SET suppressed=? WHERE id=?', body.suppressed ? 1 : 0, body.id); this.store.audit('suppress-entity', { id: body.id, suppressed: body.suppressed }, 'owner'); return json({ ok: true });
      }
      return json({ error: 'unknown_operation' }, 400);
    } catch (error) { console.error(JSON.stringify({ event: 'shard_error', message: String(error) })); return json({ error: isRequestQuotaError(error) ? 'storage_request_quota_exhausted' : 'storage_operation_failed' }, 500); }
  }
}

export class LiveControl {
  state: State; env: Env; store: Store;
  catalogValue: any = null; catalogFlight: Promise<any> | null = null;
  constructor(state: State, env: Env) { this.state = state; this.env = env; this.store = new Store(state.storage); }
  async catalog(): Promise<any> {
    if (!this.catalogValue) this.catalogValue = this.store.get('public-catalog-v1');
    if (this.catalogValue && this.catalogValue.as_of.slice(0, 10) === iso().slice(0, 10) && Date.now() - Date.parse(this.catalogValue.as_of) < 900000) return this.catalogValue;
    if (!this.catalogFlight) this.catalogFlight = (async () => {
      const parts = await Promise.all(Array.from({ length: SHARDS }, (_, i) => rpc(this.env.LIVE_SHARDS, shardName(i), 'summary')));
      const value = { as_of: iso(), shards: parts.map(p => ({ stats: p.stats, topics: p.topics })), items: parts.flatMap(p => p.items), examples: parts.flatMap(p => p.examples).slice(0, 6), changes: parts.flatMap(p => p.changes).sort((a, b) => b.observed_at.localeCompare(a.observed_at) || b.id.localeCompare(a.id)).slice(0, 100) };
      this.store.set('public-catalog-v1', value); this.catalogValue = value; return value;
    })().finally(() => { this.catalogFlight = null; });
    return this.catalogFlight;
  }
  stateView(): any {
    const config = this.store.get('monetization', { mode: this.env.MONETIZATION_MODE || 'observe', pay_per_crawl: 'unverified', pay_per_use: 'unverified', price_usd: null, accepted_buyers: [], provider_evidence: null });
    return { config, bootstrap: this.store.get('bootstrap'), last_cron: this.store.get('last-cron'), discovery: this.store.get('discovery', {}), demand_growth: this.store.get('demand-growth'),
      revenue: this.store.rows('SELECT program,currency,substr(occurred_at,1,10) AS day,sum(amount_micros) AS amount_micros,sum(uses) AS uses FROM monetization_events GROUP BY program,currency,day ORDER BY day DESC LIMIT 180'),
      top_earning_pages: this.store.rows('SELECT path,program,sum(amount_micros) AS amount_micros,sum(uses) AS uses FROM monetization_events GROUP BY path,program ORDER BY amount_micros DESC LIMIT 20'),
      category_revenue: this.store.rows('SELECT path,sum(amount_micros) AS amount_micros FROM monetization_events WHERE occurred_at>=? GROUP BY path', iso().slice(0, 7) + '-01'),
      costs: this.store.rows('SELECT * FROM costs ORDER BY month DESC LIMIT 12'),
      corrections: this.store.rows('SELECT * FROM corrections ORDER BY created_at DESC LIMIT 50'),
      audit: this.store.rows('SELECT * FROM audit_log ORDER BY timestamp DESC LIMIT 50'),
      report_count: this.store.one('SELECT count(*) AS n FROM monetization_events')!.n,
      revenue_status: this.store.one('SELECT count(*) AS n FROM monetization_events')!.n ? 'provider-reports-imported' : 'no-provider-reports',
    };
  }
  async fetch(request: Request): Promise<Response> {
    try {
      const body = await request.json() as Row, { op } = body;
      if (op === 'catalog') return json({ ...await this.catalog(), last_cron: this.store.get('last-cron') });
      if (op === 'catalog-invalidate') { await this.catalogFlight?.catch(() => {}); this.catalogValue = null; this.store.set('public-catalog-v1', null); return json({ ok: true }); }
      if (op === 'get') return json(this.store.get(body.key));
      if (op === 'set') { this.store.set(body.key, body.value); return json({ ok: true }); }
      if (op === 'state') return json(this.stateView());
      if (op === 'rate-limit') return json({ allowed: this.store.limit(body.key, body.max, body.windowMs) });
      if (op === 'source-lease') {
        if (!SOURCE_HOSTS.has(body.domain)) throw new Error('domain_not_allowed');
        const row = this.store.one('SELECT * FROM domain_leases WHERE domain=?', body.domain), now = Date.now();
        if (row && row.until_ms > now) return json({ token: null, retry_after_ms: row.until_ms - now });
        const token = crypto.randomUUID(); this.store.run('INSERT INTO domain_leases VALUES(?,?,?) ON CONFLICT(domain) DO UPDATE SET token=excluded.token,until_ms=excluded.until_ms', body.domain, token, now + 120000);
        return json({ token });
      }
      if (op === 'source-release') {
        const gap = body.domain === 'api.github.com' ? 75000 : 1000;
        this.store.run('UPDATE domain_leases SET token=?,until_ms=? WHERE domain=? AND token=?', '', Date.now() + gap, body.domain, body.token); return json({ ok: true });
      }
      if (op === 'source-cooldown') {
        this.store.run('UPDATE domain_leases SET token=?,until_ms=max(until_ms,?) WHERE domain=?', 'cooldown', body.until, body.domain); return json({ ok: true });
      }
      if (op === 'robots-get') return json(this.store.one('SELECT * FROM robots WHERE domain=?', body.domain));
      if (op === 'robots-set') {
        this.store.run('INSERT INTO robots VALUES(?,?,?,?) ON CONFLICT(domain) DO UPDATE SET body=excluded.body,checked_at=excluded.checked_at,status=excluded.status', body.domain, body.body, body.checked_at, body.status); return json({ ok: true });
      }
      if (op === 'correction') {
        const id = crypto.randomUUID(); this.store.run('INSERT INTO corrections(id,fact_id,message,source_url,created_at) VALUES(?,?,?,?,?)', id, body.fact_id, body.message, body.source_url, iso()); return json({ id, status: 'pending-review' });
      }
      if (op === 'correction-review') {
        if (!['accepted-for-verification', 'rejected'].includes(body.status)) throw new Error('invalid_review');
        this.store.run('UPDATE corrections SET status=?,resolution=? WHERE id=?', body.status, body.resolution, body.id);
        this.store.audit('correction-review', { id: body.id, status: body.status }, 'owner'); return json({ ok: true, trusted_facts_modified: false });
      }
      if (op === 'monetization-config') {
        const config = body.config;
        if (!['off', 'observe', 'selective', 'full'].includes(config.mode)) throw new Error('invalid_mode');
        for (const key of ['pay_per_crawl', 'pay_per_use']) if (!['unverified', 'active', 'eligible-not-enabled', 'beta-access-required', 'unavailable'].includes(config[key])) throw new Error('invalid_provider_state');
        if ([config.pay_per_crawl, config.pay_per_use].includes('active') && (!config.provider_evidence || !/^https:\/\/(dash|developers)\.cloudflare\.com\//.test(config.provider_evidence) || !config.verified_at || !Number.isFinite(Date.parse(config.verified_at)))) throw new Error('provider_confirmation_required');
        if (['selective', 'full'].includes(config.mode) && (config.pay_per_crawl !== 'active' || !config.discovery_exemptions_verified || !config.dynamic_pricing_verified || !/^\d+(\.\d{1,6})?$/.test(String(config.price_usd)))) throw new Error('charging_prerequisites_not_verified');
        this.store.set('monetization', { ...config, status_evidence_type: 'owner-confirmed-provider-dashboard' }); this.store.audit('monetization-config', config, 'owner'); return json({ ok: true });
      }
      if (op === 'report-import') {
        if (!/^[0-9a-f]{64}$/.test(body.report_hash) || !validReportRef(body.report_reference) || !Array.isArray(body.events) || body.events.length > 1000) throw new Error('invalid_report');
        let imported = 0;
        this.store.storage.transactionSync(() => {
          for (const event of body.events) {
            if (!['pay-per-crawl', 'pay-per-use'].includes(event.program) || event.currency !== 'USD' || !Number.isSafeInteger(event.amount_micros) || event.amount_micros < 0 || !Number.isSafeInteger(event.uses) || event.uses < 1 || event.uses > 100000000 || !event.external_id || String(event.external_id).length > 200 || !/^\/(fact|live|history|changes)\//.test(event.path) || event.path.length > 500 || !Number.isFinite(Date.parse(event.occurred_at)) || Date.parse(event.occurred_at) > Date.now() + 60000 || !event.buyer || event.buyer.length > 200) throw new Error('invalid_monetization_event');
            const existing = this.store.one('SELECT * FROM monetization_events WHERE program=? AND external_id=?', event.program, event.external_id);
            if (existing) {
              if (existing.amount_micros !== event.amount_micros || existing.uses !== event.uses || existing.path !== event.path || existing.buyer !== event.buyer) throw new Error('conflicting_provider_event');
              continue;
            }
            this.store.run('INSERT INTO monetization_events VALUES(?,?,?,?,?,?,?,?,?,?,?,?)', crypto.randomUUID(), event.external_id, event.program, event.buyer, event.path, event.occurred_at, event.amount_micros, 'USD', event.uses, body.report_hash, body.report_reference, iso()); imported++;
          }
          this.store.audit('provider-report-import', { imported, report_hash: body.report_hash, report_reference: body.report_reference }, 'owner');
        }); return json({ imported, duplicate_events: body.events.length - imported });
      }
      if (op === 'cost') {
        if (!/^\d{4}-\d{2}$/.test(body.month) || !Number.isSafeInteger(body.amount_micros) || body.amount_micros < 0 || !body.reference || String(body.reference).length > 500) throw new Error('invalid_cost_record');
        this.store.run('INSERT INTO costs VALUES(?,?,?,?) ON CONFLICT(month) DO UPDATE SET amount_micros=excluded.amount_micros,reference=excluded.reference,recorded_at=excluded.recorded_at', body.month, body.amount_micros, body.reference, iso()); this.store.audit('invoice-cost', { month: body.month, amount_micros: body.amount_micros }, 'owner'); return json({ ok: true });
      }
      return json({ error: 'unknown_operation' }, 400);
    } catch (error) { console.error(JSON.stringify({ event: 'control_error', message: String(error) })); return json({ error: error instanceof Error ? error.message : 'control_operation_failed' }, 400); }
  }
}
function validReportRef(value: any): boolean { return typeof value === 'string' && value.length <= 500 && /^(https:\/\/(dash\.cloudflare\.com|[a-z0-9.-]+\.cloudflare\.com)\/|cloudflare-report:)/.test(value); }
