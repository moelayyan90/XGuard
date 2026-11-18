import test from 'node:test';
import assert from 'node:assert/strict';
import { capacitySignals } from './infra-capacity-policy.mjs';

test('missing and malformed provider counters cannot become healthy zero usage', () => {
  for (const totals of [null, {}, {rows_read:NaN, rows_written:0}, {rows_read:-1, rows_written:0}, {rows_read:0, rows_written:'0'}]) assert.equal(capacitySignals(totals,'2026-11-18T00:00:00Z','2026-11-18T04:00:00Z'),null);
});
test('a dangerous daily rate warns before actual usage reaches the 50% alert', () => {
  const [reads] = capacitySignals({rows_read:1255676,rows_written:21424},'2026-11-18T00:00:00Z','2026-11-18T04:35:12.146Z');
  assert.equal(reads.threshold,0); assert.ok(reads.projected_day_total>5000000);
  assert.ok(reads.projected_exhaustion_at<'2026-11-19T00:00:00Z');
});
test('startup projections are withheld and actual 90% exhaustion remains critical', () => {
  assert.equal(capacitySignals({rows_read:100000,rows_written:0},'2026-11-18T00:00:00Z','2026-11-18T00:01:00Z')[0].projected_day_total,null);
  assert.equal(capacitySignals({rows_read:4772608,rows_written:57350},'2026-11-17T00:00:00Z','2026-11-17T23:00:22Z')[0].threshold,90);
  assert.equal(capacitySignals({rows_read:0,rows_written:0},'2026-11-18T00:00:00Z','2026-11-18T04:00:00Z')[0].projected_exhaustion_at,null);
});
