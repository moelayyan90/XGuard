import test from 'node:test';
import assert from 'node:assert/strict';
import { catalogCapacity } from '../src/live/capacity.ts';
import { LiveControl } from '../src/live/objects.ts';
import { Store } from '../src/live/store.ts';
import { storage } from './live-harness.mjs';

test('measured catalog pacing leaves most of the daily SQL allowance for other work', () => {
  const plan = catalogCapacity(51188);
  assert.equal(plan.projected_rows_at_minimum_interval, 4914048);
  assert.ok(plan.refresh_interval_seconds > 5400);
  assert.ok(plan.projected_rows_per_day <= 800000);
  assert.equal(plan.allocated_rows_per_day, 1000000);
  assert.equal(plan.pacing_active, true);
  assert.match(plan.scope, /Not measured account-wide/);
  assert.equal(catalogCapacity(1000).refresh_interval_seconds, 900);
  for (const value of [null, undefined, -1, Infinity, NaN, '51188']) assert.equal(catalogCapacity(value).refresh_interval_seconds, 900);
  assert.equal(catalogCapacity(1e12).refresh_interval_seconds, 86400);
});

test('catalog pacing uses persisted measurement across restarts and still refreshes on a new UTC day', async () => {
  const oldNow = Date.now, db = storage(), at = Date.parse('2026-11-09T10:00:00Z');
  const snapshot = { as_of: new Date(at).toISOString(), profile_version: 2, profile: { rows_read: 51188 }, search_items: [], shards: [], examples: [], changes: [] };
  let calls = 0;
  const env = { LIVE_SHARDS: { idFromName: x => x, get: () => ({ fetch: async () => { calls++; throw Error('fresh-read-required'); } }) } };
  try {
    Date.now = () => at + 3600000;
    const store = new Store(db); store.set('public-catalog-v1', snapshot);
    for (let i = 0; i < 2; i++) {
      const control = new LiveControl({ storage: db }, env);
      const result = await control.catalog(); assert.equal(result.as_of, snapshot.as_of);
      assert.equal(result.capacity.pacing_active, true); assert.equal(calls, 0);
    }
    Date.now = () => at + catalogCapacity(51188).refresh_interval_seconds * 1000;
    await assert.rejects(new LiveControl({ storage: db }, env).catalog(), /fresh-read-required/);
    calls = 0; Date.now = () => Date.parse('2026-11-10T00:00:01Z');
    await assert.rejects(new LiveControl({ storage: db }, env).catalog(), /fresh-read-required/);
    assert.ok(calls > 0);
  } finally { Date.now = oldNow; db.db.close(); }
});

test('source demand reads only the current and previous UTC day for the requested path', () => {
  const db = storage(), store = new Store(db), now = Date.parse('2026-11-09T00:00:01Z');
  try {
    for (const [day, path, count] of [['2026-11-07', '/live/npm/react', 1000], ['2026-11-08', '/live/npm/react', 5], ['2026-11-09', '/live/npm/react', 7], ['2026-11-09', '/live/npm/other', 500]]) {
      store.run('INSERT INTO request_metrics VALUES(?,?,?,?,?,?,?,?,?)', day, path, '', 'unclassified', 200, 'MISS', count, 0, 0);
    }
    assert.equal(store.recentDemand('/live/npm/react', now), 12);
    assert.equal(store.recentDemand('/live/npm/missing', now), 0);
    const plan = store.rows('EXPLAIN QUERY PLAN SELECT sum(requests) AS n FROM request_metrics WHERE day IN (?,?) AND path=?', '2026-11-08', '2026-11-09', '/live/npm/react');
    assert.ok(plan.some(row => /SEARCH.*day=\? AND path=\?/.test(row.detail)));
  } finally { db.db.close(); }
});
