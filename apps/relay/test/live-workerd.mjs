import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const path = process.env.LIVE_WORKER_BUNDLE || fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: resolve(path, '..'), workers: [{ name: 'live-test', modules: true, modulesRoot: resolve(path, '..'), scriptPath: path, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LIVE_SHARDS: { className: 'LiveShard', useSQLite: true }, LIVE_CONTROL: { className: 'LiveControl', useSQLite: true } },
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'off', MONETIZATION_MODE: 'observe' } }] }));
try {
  await mf.ready;
  const response = await mf.dispatchFetch('https://xguardgate.com/healthz');
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.shards, 32); assert.equal(body.facts, 0);
  const ns = await mf.getDurableObjectNamespace('LIVE_SHARDS'); const stub = ns.get(ns.idFromName('catalog-v1-0'));
  const seed = await stub.fetch('https://internal/rpc', { method: 'POST', body: JSON.stringify({ op: 'seed', sources: [{ adapter: 'npm', identifier: 'react' }] }) });
  assert.equal((await seed.json()).queued, 1);
  const stats = await stub.fetch('https://internal/rpc', { method: 'POST', body: '{"op":"stats"}' }); assert.equal((await stats.json()).pending, 1);
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/admin')).status, 401);
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'application/json' } })).headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(await (await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'text/html' } })).text(), /The live facts/);
  console.log('workerd integration: SQLite migration, 32 shards, durable queue, auth and format cache verified.');
} finally { await mf.dispose(); }
