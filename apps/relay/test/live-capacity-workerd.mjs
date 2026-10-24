import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.LIVE_BASELINE_ROOT, 'Supply the exact base checkout, not an estimated resource budget');
const roots = { before: resolve(process.env.LIVE_BASELINE_ROOT), after: fileURLToPath(new URL('../../../', import.meta.url)) };
const directory = await mkdtemp(join(tmpdir(), 'xguard-capacity-'));
let runtime;
try {
  // Local-only instrumentation wraps the real collector. No diagnostic route or
  // fixture class is included in the production entrypoint or deployed bundle.
  for (const [name, root] of Object.entries(roots)) {
    await build({ stdin: { contents: `
      import { LiveShard } from ${JSON.stringify(join(root, 'apps/relay/src/live/objects.ts'))};
      import { sourceSpec } from ${JSON.stringify(join(root, 'apps/relay/src/live/adapters.ts'))};
      export class CapacityShard extends LiveShard {
        async fetch() {
          this.store.enqueue(sourceSpec('npm', 'react'));
          this.store.set('cleanup-day', new Date().toISOString().slice(0, 10));
          const before = this.store.rowsWritten;
          await this.alarm();
          return Response.json({ rows_written: this.store.rowsWritten - before, source: this.store.one('SELECT id,lease_until,next_fetch FROM sources'), observations: this.store.one('SELECT count(*) AS n FROM fact_observations').n });
        }
      }
      export class BusyDomain { async fetch() { return Response.json({ token: null, retry_after_ms: 120000 }); } }
      export default { async fetch(request, env) { return env.LIVE_SHARDS.get(env.LIVE_SHARDS.idFromName('fixture')).fetch(request); } };
    `, resolveDir: root }, outfile: join(directory, `${name}.mjs`), bundle: true, format: 'esm', target: 'es2022', platform: 'browser' });
  }
  runtime = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: directory, workers: Object.keys(roots).map(name => ({
    name, modules: true, modulesRoot: directory, scriptPath: join(directory, `${name}.mjs`), compatibilityDate: '2026-08-25',
    durableObjects: { LIVE_SHARDS: { className: 'CapacityShard', useSQLite: true }, LIVE_CONTROL: { className: 'BusyDomain', useSQLite: true } },
    bindings: { LIVE_SOURCE_FETCHES: 'on' },
    outboundService: () => { throw new Error('Contention must not fetch an external source'); },
  })) }));
  await runtime.ready;
  const measured = {};
  for (const name of Object.keys(roots)) {
    const worker = await runtime.getWorker(name), response = await worker.fetch('https://fixture.test/');
    assert.equal(response.status, 200); measured[name] = await response.json();
    assert.equal(measured[name].source.lease_until, 0); assert.equal(measured[name].observations, 0);
  }
  assert.equal(measured.after.source.next_fetch, 0, 'a denied domain lease must not rewrite the source');
  assert.ok(measured.after.rows_written > 0, 'use real workerd SQLite row counters');
  assert.ok(measured.after.rows_written <= measured.before.rows_written, JSON.stringify(measured));
  if (measured.before.source.next_fetch > 0) assert.ok(measured.after.rows_written < measured.before.rows_written);
  const report = { baseline_sha: process.env.LIVE_BASELINE_SHA || null, scope: 'One real collector alarm with one due source and a busy upstream domain, in isolated workerd SQLite. Excludes alarm metadata and other account workloads; not a production bill or account-wide capacity claim.', before_rows_written: measured.before.rows_written, after_rows_written: measured.after.rows_written, source_fetches: 0, payments: 0 };
  console.log(JSON.stringify(report));
  if (process.env.LIVE_CAPACITY_REPORT) await writeFile(process.env.LIVE_CAPACITY_REPORT, JSON.stringify(report, null, 2));
} finally { if (runtime) await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
