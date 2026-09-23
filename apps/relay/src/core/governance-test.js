import test from 'node:test';
import assert from 'node:assert/strict';
import { validateGovernancePolicy, evaluateForecast, reserveDailyExposure } from './governance.js';

const digest = 'a'.repeat(64);
function policy(patch = {}) {
  return { version: 1, currency: 'USD', minimum_net_usd_micros: '10', daily_cost_limit_usd_micros: '1000', forecasts: [{
    request_digest: digest, revenue_if_success_usd_micros: '100', success_probability_bps: 10000, failure_loss_usd_micros: '0',
    api_cost_usd_micros: '90', compute_cost_usd_micros: '0', payment_cost_usd_micros: '0', slippage_cost_usd_micros: '0', safety_buffer_cost_usd_micros: '0',
    valid_until: new Date(Date.now() + 60000).toISOString(), ...patch,
  }] };
}
test('strict financial floor refuses equality; rounding is conservative', () => {
  const p = validateGovernancePolicy(policy());
  assert.equal(evaluateForecast(p, digest).allowed, false);
  p.forecasts[0].revenue_if_success_usd_micros = '101';
  assert.equal(evaluateForecast(p, digest).allowed, true);
  const rounded = evaluateForecast(policy({ success_probability_bps: 3333, revenue_if_success_usd_micros: '101', failure_loss_usd_micros: '1' }), digest);
  assert.equal(rounded.expected_gross_usd_micros, '33');
  assert.equal(rounded.expected_failure_loss_usd_micros, '1');
  assert.equal(rounded.net_expected_usd_micros, '-58');
});
test('forecast arithmetic stays exact above floating-point intermediate precision', () => {
  const p = policy({ revenue_if_success_usd_micros: '999999999999999', success_probability_bps: 9999 });
  const expected = (999999999999999n * 9999n / 10000n).toString();
  assert.equal(evaluateForecast(validateGovernancePolicy(p), digest).expected_gross_usd_micros, expected);
});
test('invalid amounts, probabilities, extra fields and stale forecasts fail closed', () => {
  assert.throws(() => validateGovernancePolicy(undefined), /governance_policy_required/);
  for (const amount of [NaN, Infinity, -1, '1.2', '-1', '01', '1000000000000001', 100]) assert.throws(() => validateGovernancePolicy(policy({ api_cost_usd_micros: amount })));
  for (const probability of [-1, 10001, 0.1, '9000']) assert.throws(() => validateGovernancePolicy(policy({ success_probability_bps: probability })));
  assert.throws(() => validateGovernancePolicy(policy({ client_profit_override: '900000' })));
  assert.throws(() => evaluateForecast(policy({ valid_until: new Date(Date.now() - 1).toISOString() }), digest), /expired/);
  assert.throws(() => evaluateForecast(policy(), 'b'.repeat(64)), /missing/);
});
test('daily reservation is atomic, idempotent, conflict-bound and resets only on UTC date change', async () => {
  const values = new Map(); let queue = Promise.resolve();
  const storage = { get: async k => values.get(k), put: async (k,v) => values.set(k,v), transaction(fn) { const next = queue.then(() => fn(this)); queue = next.catch(() => {}); return next; } };
  const make = n => ({ execution_id: 'xge_' + String(n).padStart(32, '0'), amount: '600', limit: '1000' });
  const day = Date.parse('2026-09-22T23:59:59Z');
  const results = await Promise.all([reserveDailyExposure(storage, make(1), day), reserveDailyExposure(storage, make(2), day)]);
  assert.deepEqual(results.map(x => x.allowed), [true, false]);
  assert.equal((await reserveDailyExposure(storage, make(1), day)).reserved_usd_micros, '600');
  await assert.rejects(reserveDailyExposure(storage, { ...make(1), amount: '1' }, day), /conflict/);
  assert.equal((await reserveDailyExposure(storage, make(2), day + 1000)).reserved_usd_micros, '600');
});
