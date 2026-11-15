import { fail, integer, json } from './common.js';

const snapshot = day => ({ day, quotes: 0, paid_quotes: 0, executions: 0, successful_executions: 0, failed_executions: 0, failovers: 0, payment_failures: 0, gross_revenue_atomic: 0, fulfilled_revenue_atomic: 0, measured_upstream_cost_atomic: 0, unknown_cost_executions: 0, configured_network_cost_atomic: 0, configured_infrastructure_cost_atomic: 0, measured_net_margin_atomic: 0, latency_ms: 0, providers: {} });
const transitions = {
  PAYMENT_PENDING: ['SETTLEMENT_UNKNOWN', 'SETTLED', 'PAYMENT_FAILED'],
  SETTLEMENT_UNKNOWN: ['SETTLED'],
  EXECUTING: ['EXECUTION_UNKNOWN', 'REFUND_REQUIRED', 'RUNNING', 'DELIVERY_PENDING'],
  RUNNING: ['DELIVERY_PENDING', 'REFUND_REQUIRED', 'EXECUTION_UNKNOWN'],
};

// Reuse the existing PaidGatewayState binding in a distinct named object.
// Existing payment and witness namespaces, migrations and state are untouched.
// Every claim/cap mutation is transactional. No network call occurs inside a
// transaction, and no failed/uncertain upstream can re-enter an execution state.
export async function computeState(state, env, action, body) {
  try {
    const result = await state.storage.transaction(async tx => {
      const day = new Date().toISOString().slice(0, 10), dayKey = 'compute:v1:day:' + day;
      const metrics = await tx.get(dayKey) || snapshot(day);
      const key = 'compute:v1:quote:' + body.quote_id;
      let q = body.quote_id ? await tx.get(key) : null;
      const save = async () => { q.updated_at = new Date().toISOString(); await tx.put(key, q); };
      const releaseBudget = async reservation => {
        const oldMetrics = reservation.day_key === dayKey ? metrics : await tx.get(reservation.day_key);
        if (oldMetrics?.providers[reservation.provider]) {
          oldMetrics.providers[reservation.provider].reserved_atomic = Math.max(0, oldMetrics.providers[reservation.provider].reserved_atomic - reservation.cost_bound_atomic);
          await tx.put(reservation.day_key, oldMetrics);
        }
        await tx.put(reservation.budget_key, Math.max(0, (await tx.get(reservation.budget_key) || 0) - reservation.cost_bound_atomic));
      };
      const reserveBudget = async (provider, amount, budgets) => {
        const maxRequest = integer(budgets.request_cap_atomic, 0, 1), maxDay = integer(budgets.daily_cap_atomic, 0, 1), prepaid = integer(budgets.prepaid_available_atomic, 0, 1);
        const providerKey = 'compute:v1:budget:' + provider + ':' + String(budgets.balance_epoch || 'initial').slice(0, 80);
        const spent = await tx.get(providerKey) || 0;
        const stats = metrics.providers[provider] ||= { reserved_atomic: 0, attempts: 0, failures: 0, latency_ms: 0 };
        if (amount > maxRequest || stats.reserved_atomic + amount > maxDay || spent + amount > prepaid) throw fail('provider_spending_cap', 503);
        stats.reserved_atomic += amount;
        if (prepaid - spent - amount <= integer(budgets.low_balance_atomic, maxRequest)) console.warn(JSON.stringify({ event: 'compute_provider_low_balance', provider }));
        await tx.put(providerKey, spent + amount);
        return { provider, cost_bound_atomic: amount, budget_key: providerKey, day_key: dayKey };
      };
      if (action === 'metrics') return { ...metrics, providers: Object.fromEntries(Object.entries(metrics.providers).map(([name, p]) => [name, { ...p, error_rate: p.attempts ? p.failures / p.attempts : null }])), currency: 'USDC', decimals: 6, accounting_scope: 'Compute gateway only; UTC day. Provider usage costs are accruals, not reconciled invoices. Reservations include uncertain jobs.', average_latency_ms: metrics.successful_executions ? Math.round(metrics.latency_ms / metrics.successful_executions) : null, average_margin_percentage: metrics.fulfilled_revenue_atomic && !metrics.unknown_cost_executions ? metrics.measured_net_margin_atomic / metrics.fulfilled_revenue_atomic * 100 : null };
      if (action === 'quote') {
        if (!/^xcq_[a-f0-9]{32}$/.test(body.record?.quote_id || '')) throw fail('invalid_quote');
        const limit = integer(env.XGUARD_COMPUTE_DAILY_QUOTE_CAP, 100, 1, 10000);
        if (metrics.quotes >= limit) throw fail('compute_daily_quote_cap', 429);
        metrics.quotes++;
        await tx.put(dayKey, metrics);
        await tx.put('compute:v1:quote:' + body.record.quote_id, { ...body.record, status: 'QUOTED', attempts: [], created_at: new Date().toISOString(), updated_at: new Date().toISOString() });
        await tx.put('compute:v1:unpaid:' + body.record.quote_id, body.record.expires_at);
        if (!await tx.get('compute:v1:managed')) await tx.put('compute:v1:managed', true);
        const alarm = await tx.getAlarm();
        if (!alarm || alarm > Date.now() + 600000) await tx.setAlarm(Date.now() + 600000);
        return { ok: true };
      }
      if (!q) throw fail('execution_not_found', 404);
      if (action === 'get') return { record: q };
      if (action === 'claim-payment') {
        if (q.status !== 'QUOTED') return { claimed: false, record: q };
        if (q.expires_at <= Date.now()) throw fail('quote_expired', 409);
        const requestKey = 'compute:v1:request:' + body.request_key;
        const existing = await tx.get(requestKey);
        if (existing && existing !== q.quote_id) throw fail('idempotency_conflict', 409, { original_quote_id: existing, new_payment_required: false });
        // Capacity is reserved after signature verification and before /settle.
        // An unpaid quote cannot monopolize prepaid funds. Concurrent paid
        // purchases cannot both consume the same provider balance/cap.
        q.payment_budget = await reserveBudget(q.routes[0].provider, q.price.upstream_cost_bound_atomic, body.budgets);
        await tx.put(requestKey, q.quote_id);
        await tx.delete('compute:v1:unpaid:' + q.quote_id);
        q = { ...q, status: 'PAYMENT_PENDING', payment: body.payment, payment_reserved_at: new Date().toISOString() };
        await save(); await tx.put(dayKey, metrics); return { claimed: true, record: q };
      }
      if (action === 'transition') {
        if (q.status !== body.from || !transitions[q.status]?.includes(body.to)) return { changed: false, record: q };
        q.status = body.to;
        if (body.observed_transaction && /^0x[a-fA-F0-9]{64}$/.test(body.observed_transaction)) q.payment.observed_transaction = body.observed_transaction;
        if (body.to === 'SETTLED') {
          q.settlement = body.settlement;
          q.revenue_eligible = q.traffic_class === 'external' && q.payment.payer.toLowerCase() !== q.payment.pay_to.toLowerCase();
          metrics.paid_quotes++; metrics.settled_volume_atomic = (metrics.settled_volume_atomic || 0) + q.price.customer_price_atomic;
          if (q.revenue_eligible) metrics.gross_revenue_atomic += q.price.customer_price_atomic;
        }
        if (body.to === 'PAYMENT_FAILED') metrics.payment_failures++;
        if (['EXECUTION_UNKNOWN', 'REFUND_REQUIRED'].includes(body.to)) {
          metrics.failed_executions++; q.refund_state = body.to === 'REFUND_REQUIRED' ? 'refund_due' : 'execution_reconciliation_required';
          const attempt = q.attempts.at(-1);
          if (attempt && metrics.providers[attempt.provider]) metrics.providers[attempt.provider].failures++;
        }
        if (body.to === 'REFUND_REQUIRED' && q.payment_budget) { await releaseBudget(q.payment_budget); delete q.payment_budget; }
        q.reason = body.reason || null;
        await save(); await tx.put(dayKey, metrics); return { changed: true, record: q };
      }
      if (action === 'claim-execution') {
        if (q.status !== 'SETTLED') return { claimed: false, record: q };
        q.status = 'EXECUTING'; q.claim_token = crypto.randomUUID(); q.execution_started_at = Date.now();
        metrics.executions++; await save(); await tx.put(dayKey, metrics); return { claimed: true, record: q };
      }
      if (action === 'reserve-attempt') {
        if (q.status !== 'EXECUTING' || q.claim_token !== body.claim_token || q.attempts.some(x => x.state !== 'REJECTED')) throw fail('execution_already_reserved', 409);
        if (q.attempts.length >= 3) throw fail('failover_limit_exceeded', 409);
        const p = q.routes.find(x => x.provider === body.provider);
        if (!p || !Number.isSafeInteger(body.cost_atomic) || body.cost_atomic < 1 || body.cost_atomic > q.price.upstream_cost_bound_atomic) throw fail('cost_exceeds_paid_budget', 409);
        let reservation;
        if (q.payment_budget?.provider === body.provider && body.cost_atomic <= q.payment_budget.cost_bound_atomic) reservation = q.payment_budget;
        else {
          if (q.payment_budget) await releaseBudget(q.payment_budget);
          reservation = await reserveBudget(body.provider, body.cost_atomic, body.budgets);
        }
        delete q.payment_budget;
        metrics.providers[body.provider].attempts++;
        if (q.attempts.length) metrics.failovers++;
        q.attempts.push({ ...reservation, state: 'RESERVED', at: new Date().toISOString() });
        await save(); await tx.put(dayKey, metrics); return { record: q };
      }
      if (action === 'reject-attempt') {
        const attempt = q.attempts.at(-1);
        if (q.status !== 'EXECUTING' || q.claim_token !== body.claim_token || attempt?.state !== 'RESERVED' || attempt.provider !== body.provider) throw fail('invalid_attempt', 409);
        attempt.state = 'REJECTED';
        const priorMetrics = attempt.day_key === dayKey ? metrics : await tx.get(attempt.day_key);
        priorMetrics.providers[body.provider].reserved_atomic -= attempt.cost_bound_atomic;
        priorMetrics.providers[body.provider].failures++;
        await tx.put(attempt.budget_key, Math.max(0, (await tx.get(attempt.budget_key) || 0) - attempt.cost_bound_atomic));
        await save(); await tx.put(attempt.day_key, priorMetrics); return { record: q };
      }
      if (action === 'accepted') {
        if (!['EXECUTING', 'RUNNING'].includes(q.status) || q.claim_token !== body.claim_token) return { changed: false, record: q };
        const attempt = q.attempts.at(-1);
        if (!attempt || !['RESERVED', 'ACCEPTED'].includes(attempt.state) || attempt.provider !== body.provider) throw fail('invalid_attempt', 409);
        attempt.state = 'ACCEPTED';
        q.provider = body.provider; q.provider_quote = body.provider_quote;
        const { result: ignoredResult, ...upstream } = body.upstream;
        q.upstream = upstream;
        if (body.upstream.completed) {
          if (JSON.stringify(body.upstream.result).length > 65536) throw fail('result_too_large', 502);
          q.status = 'DELIVERY_PENDING'; q.result = body.upstream.result; q.response_digest = body.response_digest;
        } else q.status = 'RUNNING';
        await save(); return { changed: true, record: q };
      }
      if (action === 'deliver') {
        if (q.status === 'SUCCEEDED') return { record: q };
        if (q.status !== 'DELIVERY_PENDING') throw fail('result_not_ready', 409);
        q.status = 'SUCCEEDED'; q.receipt = body.receipt; q.accounting = body.accounting;
        q.completed_at = new Date().toISOString();
        metrics.successful_executions++; metrics.fulfilled_revenue_atomic += body.accounting.gross_revenue_atomic;
        metrics.latency_ms += Math.max(0, Date.now() - q.execution_started_at);
        if (q.upstream.cost_atomic === null) metrics.unknown_cost_executions++;
        else metrics.measured_upstream_cost_atomic += q.upstream.cost_atomic;
        metrics.configured_network_cost_atomic += q.price.network_payment_cost_atomic;
        metrics.configured_infrastructure_cost_atomic += q.price.infrastructure_cost_atomic;
        metrics.measured_net_margin_atomic += body.accounting.net_margin_atomic ?? 0;
        await save(); await tx.put(dayKey, metrics); return { record: q };
      }
      throw fail('compute_state_action_not_found', 404);
    });
    return json(result);
  } catch (e) { return json({ error: e.code || 'compute_storage_unavailable', details: e.details || {} }, e.status || 503); }
}

export async function computeAlarm(state) {
  if (!await state.storage.get('compute:v1:managed')) return false;
  const pending = await state.storage.list({ prefix: 'compute:v1:unpaid:', limit: 101 });
  let remaining = false;
  for (const [key, expires] of pending) {
    if (expires > Date.now()) { remaining = true; continue; }
    const quoteKey = 'compute:v1:quote:' + key.slice('compute:v1:unpaid:'.length);
    await state.storage.transaction(async tx => {
      const q = await tx.get(quoteKey);
      if (q?.status === 'QUOTED') await tx.delete(quoteKey);
      await tx.delete(key);
    });
  }
  if (remaining || pending.size >= 101) await state.storage.setAlarm(Date.now() + 600000);
  return true;
}
