import { DatabaseSync } from 'node:sqlite';
import { LiveShard, LiveControl } from '../src/live/objects.ts';
import { Store } from '../src/live/store.ts';
import { SHARDS } from '../src/live/types.ts';
import { shardOf, shardName, hash } from '../src/live/util.ts';
import { sourceSpec, parseSource } from '../src/live/adapters.ts';

export function storage(filename = ':memory:') {
  const db = new DatabaseSync(filename); db.exec('PRAGMA foreign_keys=ON');
  const state = {
    db, alarm: null, sql: { exec(query, ...bindings) {
      const stmt = db.prepare(query);
      const rows = stmt.all(...bindings);
      return { toArray: () => rows };
    } },
    transactionSync(fn) { db.exec('SAVEPOINT live_tx'); try { const result = fn(); db.exec('RELEASE live_tx'); return result; } catch (error) { db.exec('ROLLBACK TO live_tx'); db.exec('RELEASE live_tx'); throw error; } },
    async setAlarm(time) { state.alarm = time; },
  }; return state;
}
export function environment(options = {}) {
  const objects = new Map(), controls = new Map();
  const env = { LIVE_SOURCE_FETCHES: 'off', LIVE_BOOTSTRAP: 'off', LIVE_ADMIN_KEY: 'test-key-'.repeat(8), ...options };
  const ns = (Class, map) => ({ idFromName: name => name, get(id) {
    if (!map.has(id)) { const s = storage(); map.set(id, new Class({ storage: s, blockConcurrencyWhile: fn => fn() }, env)); }
    return map.get(id);
  } });
  env.LIVE_SHARDS = ns(LiveShard, objects); env.LIVE_CONTROL = ns(LiveControl, controls);
  const pending = [];
  return { env, objects, controls, ctx: { waitUntil(p) { pending.push(p); } }, async drain() { await Promise.all(pending.splice(0)); }, close() { for (const object of [...objects.values(), ...controls.values()]) object.store.storage.db.close(); } };
}
export async function seed(harness, version = '1.0.0', observedAt = new Date().toISOString()) {
  const spec = sourceSpec('npm', 'react'), body = JSON.stringify({ name: 'react', version, license: 'MIT', engines: { node: '>=18' } });
  const object = harness.env.LIVE_SHARDS.get(shardName(shardOf(spec.id)));
  object.store.enqueue(spec);
  const fetchId = crypto.randomUUID();
  object.store.observe({ spec, ...parseSource(spec, body), observedAt, hash: await hash(body), fetchId, method: 'test-fixture' }, Date.now() + 86400000);
  return { spec, object, store: object.store };
}
