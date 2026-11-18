import test from 'node:test';
import assert from 'node:assert/strict';
import { capacitySignals, providerCounters } from './infra-capacity-policy.mjs';

test('missing and malformed provider counters cannot become healthy zero usage', () => {
  for (const totals of [null, {}, {rows_read:NaN, rows_written:0}, {rows_read:-1, rows_written:0}, {rows_read:0, rows_written:'0'}]) assert.equal(capacitySignals(totals,'2026-11-18T00:00:00Z','2026-11-18T04:00:00Z'),null);
});
test('a dangerous daily rate warns before actual usage reaches the 50% alert', () => {
  const [reads] = capacitySignals({rows_read:1255676,rows_written:21424,requests:10},'2026-11-18T00:00:00Z','2026-11-18T04:35:12.146Z');
  assert.equal(reads.threshold,0); assert.ok(reads.projected_day_total>5000000);
  assert.ok(reads.projected_exhaustion_at<'2026-11-19T00:00:00Z');
});
test('startup projections are withheld and actual 90% exhaustion remains critical', () => {
  assert.equal(capacitySignals({rows_read:100000,rows_written:0,requests:10},'2026-11-18T00:00:00Z','2026-11-18T00:01:00Z')[0].projected_day_total,null);
  assert.equal(capacitySignals({rows_read:4772608,rows_written:57350,requests:10},'2026-11-17T00:00:00Z','2026-11-17T23:00:22Z')[0].threshold,90);
  assert.equal(capacitySignals({rows_read:0,rows_written:0,requests:10},'2026-11-18T00:00:00Z','2026-11-18T04:00:00Z')[0].projected_exhaustion_at,null);
});

test('invocation exhaustion is critical even when SQLite remains within allowance', () => {
  const sql = { dataset: 'durableObjectsPeriodicGroups', groups: [{ sum: { rowsRead: 3946350, rowsWritten: 58034 } }] };
  const invocations = { dataset: 'durableObjectsInvocationsAdaptiveGroups', groups: [{ sum: {requests: 105148} }, { sum: {requests: 10375} }] };
  const totals = providerCounters([sql, invocations]);
  const signals = capacitySignals(totals, '2026-11-18T00:00:00Z', '2026-11-18T22:10:42Z');
  assert.equal(totals.requests, 115523);
  assert.equal(signals.find(s => s.metric === 'requests').threshold, 90);
  assert.equal(signals.find(s => s.metric === 'rows_read').threshold, 75);
  assert.equal(providerCounters([sql]).requests, null);
  assert.equal(providerCounters([{ ...sql, groups: [{sum: {rowsRead: 2}}] }, invocations]).rows_written, null);
});
