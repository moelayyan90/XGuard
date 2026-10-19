const SERVICES = ['live-batch', 'live-history', 'live-compare'];
export function applyLivePaidMetric(current, body) {
  const service = String(body.tool || '').replace(/^xguard\./, '');
  if (!SERVICES.includes(service) && body.tool !== 'xguard.live-catalog') return;
  if (body.traffic_class !== 'external' || body.environment !== 'production') return;
  current.live_paid ||= { since: new Date().toISOString(), events: {}, services: {} };
  const live = current.live_paid;
  live.events[body.event] = (live.events[body.event] || 0) + 1;
  const item = live.services[service] ||= { events: {} };
  item.events[body.event] = (item.events[body.event] || 0) + 1;
}
export async function applyLivePaidCommerce(tx, body, previous, snapshot) {
  if (!SERVICES.includes(body.capability)) return;
  const live = await tx.get('live-commerce:v1') || { since: new Date().toISOString(), services: {} };
  const item = live.services[body.capability] ||= { settled_cash_usd_micros: 0, recognized_revenue_usd_micros: 0, unfulfilled_liability_usd_micros: 0, successful_paid_executions: 0, estimated_contribution_usd_micros: 0 };
  for (const key of Object.keys(item)) item[key] += Number(snapshot[key] || 0) - Number(previous?.[key] || 0);
  live.updated_at = new Date().toISOString();
  await tx.put('live-commerce:v1', live);
}
export async function livePaidLedgerRoute(state, path, body) {
  const json = (v, status = 200) => Response.json(v, { status });
  if (path === '/live/reserve-request') {
    if (![body.key_hash, body.operation_hash, body.request_digest].every(x => /^[a-f0-9]{64}$/.test(x || ''))) return json({ error: 'invalid_live_reservation' }, 400);
    let conflict = false;
    await state.storage.transaction(async tx => {
      const key = `live-idempotency:${body.key_hash}`, prior = await tx.get(key);
      if (prior && (prior.operation_hash !== body.operation_hash || prior.request_digest !== body.request_digest)) conflict = true;
      else if (!prior) await tx.put(key, { operation_hash: body.operation_hash, request_digest: body.request_digest });
    });
    return json(conflict ? { error: 'live_idempotency_conflict' } : { reserved: true }, conflict ? 409 : 200);
  }
  if (path === '/live/summary') {
    const metrics = (await state.storage.get('metrics:v1'))?.live_paid || null;
    const commerce = await state.storage.get('live-commerce:v1') || null;
    const events = metrics?.events || {};
    const sum = key => commerce ? Object.values(commerce.services).reduce((n, x) => n + Number(x[key] || 0), 0) : null;
    const http = await state.storage.get('live-http:v1') || null;
    if (http) for (const item of Object.values(http.services)) {
      const ceiling = key => key === 'overflow' ? Infinity : Number(key);
      const buckets = Object.entries(item.latency_buckets).sort((a, b) => ceiling(a[0]) - ceiling(b[0]));
      const total = buckets.reduce((n, [, count]) => n + count, 0);
      const quantile = fraction => {
        let cumulative = 0;
        for (const [upper, count] of buckets) {
          cumulative += count;
          if (cumulative >= Math.ceil(total * fraction)) return Number.isFinite(ceiling(upper)) ? ceiling(upper) : null;
        }
        return null;
      };
      item.p50_origin_ms_upper_bound = quantile(.5);
      item.p95_origin_ms_upper_bound = quantile(.95);
    }
    return json({ metrics, commerce, http, payment_attempts: events.payment_attempt ?? null, verified_authorizations: events.payment_verified ?? null, settlement_success_events: events.settlement_success ?? null, signed_results_delivered: sum('successful_paid_executions'), confirmed_cash_usdc_atomic: sum('settled_cash_usd_micros'), recognized_revenue_usdc_atomic: sum('recognized_revenue_usd_micros'), unfulfilled_usdc_atomic: sum('unfulfilled_liability_usd_micros'), top_services_by_demand: Object.entries(metrics?.services || {}).map(([service, v]) => ({ service, requests: v.events.request_received || 0 })).sort((a, b) => b.requests - a.requests), top_services_by_revenue: Object.entries(commerce?.services || {}).map(([service, v]) => ({ service, usdc_atomic: v.recognized_revenue_usd_micros })).sort((a, b) => b.usdc_atomic - a.usdc_atomic), discovery_to_delivered_ratio: events.discovery && commerce ? sum('successful_paid_executions') / events.discovery : null, actual_cost_usd: null, net_profit_usd: null, payout_due_usd: null,
      scope: 'Live services only, since instrumentation. Counters are external production attempts; repeated attempts are not unique buyers. Commerce deduplicates confirmed external settlements and delivered revenue. Synthetic/internal/self-payments are excluded. Legacy internal usd_micros fields denote nominal USDC atomic units, not a fiat conversion. Direct USDC settlement is distinct from Cloudflare payout reports; actual cost and net profit are unknown.' });
  }
  if (path === '/live/response') {
    if (!['batch', 'history', 'compare'].includes(body.service) || !Number.isFinite(body.duration_ms) || body.duration_ms < 0 || !Number.isInteger(body.status)) return json({ error: 'invalid_http_metric' }, 400);
    await state.storage.transaction(async tx => {
      const http = await tx.get('live-http:v1') || { since: new Date().toISOString(), scope: 'External-classified origin POST responses only; histogram upper bounds, not end-to-end client latency or free-site traffic.', services: {} };
      const item = http.services[body.service] ||= { statuses: {}, latency_buckets: {} };
      const bucket = [1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 30000, 60000, 120000].find(x => body.duration_ms <= x) || 'overflow';
      item.statuses[body.status] = (item.statuses[body.status] || 0) + 1;
      item.latency_buckets[bucket] = (item.latency_buckets[bucket] || 0) + 1;
      await tx.put('live-http:v1', http);
    });
    return json({ ok: true });
  }
  if (path === '/live/circuit') return json(await state.storage.get('live-circuit:v1') || { paused_until: 0, failures: 0 });
  if (path === '/live/circuit-reset') { await state.storage.delete('live-circuit:v1'); return json({ reset: true }); }
  if (path === '/live/health') {
    await state.storage.transaction(async tx => {
      const now = Date.now(); let circuit = await tx.get('live-circuit:v1') || { started_at: now, failures: 0, paused_until: 0 };
      if (now - circuit.started_at > 300000) circuit = { started_at: now, failures: 0, paused_until: circuit.paused_until };
      if (body.failed === true) circuit.failures++;
      if (circuit.failures >= 3) circuit.paused_until = now + 900000;
      await tx.put('live-circuit:v1', circuit);
    });
    return json({ ok: true });
  }
  return json({ error: 'unknown_live_financial_operation' }, 404);
}
