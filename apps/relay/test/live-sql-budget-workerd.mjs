import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.LIVE_BASELINE_ROOT, 'An exact base checkout is required');
const roots = { before: resolve(process.env.LIVE_BASELINE_ROOT), after: fileURLToPath(new URL('../../../', import.meta.url)) };
const directory = await mkdtemp(join(tmpdir(), 'xguard-sql-budget-')), at = Date.now(); let runtime;
try {
  for (const [name, root] of Object.entries(roots)) await build({ stdin: { resolveDir: root, contents: `
    import { LiveShard, LiveControl } from ${JSON.stringify(join(root, 'apps/relay/src/live/objects.ts'))};
    import { sourceSpec, parseSource } from ${JSON.stringify(join(root, 'apps/relay/src/live/adapters.ts'))};
    import { hash, shardName, controlName } from ${JSON.stringify(join(root, 'apps/relay/src/live/util.ts'))};
    export { LiveControl };
    export class BudgetShard extends LiveShard {
      async fetch(request) {
        const body = await request.clone().json();
        if (body.op === 'fixture-seed') {
          for (let j = 0; j < 80; j++) {
            const spec = sourceSpec('npm', 'budget-' + body.shard + '-' + String(j).padStart(3, '0'));
            const raw = JSON.stringify({ name: spec.identifier, version: '1.0.0', license: 'MIT', engines: { node: '>=18' } });
            this.store.enqueue(spec);
            this.store.observe({ spec, ...parseSource(spec, raw), observedAt: new Date(Number(this.env.FIXTURE_AT) - (body.shard * 80 + j) * 1000).toISOString(), hash: await hash(raw), fetchId: crypto.randomUUID(), method: 'isolated-fixture' }, 0);
          }
          return Response.json({ seeded: 80 });
        }
        if (body.op === 'fixture-workload') {
          const source = this.store.one('SELECT * FROM sources ORDER BY id LIMIT 1');
          const start = this.store.rowsWritten;
          this.store.revalidated(source, new Date().toISOString(), Date.now() + 10000000);
          const revalidation = this.store.rowsWritten - start;
          const beforePeek = this.store.rowsRead; this.store.peekDue(); const peek = this.store.rowsRead - beforePeek;
          const spec = sourceSpec('npm', JSON.parse(source.spec_json).identifier), raw = JSON.stringify({ name: spec.identifier, version: '2.0.0', license: 'MIT', engines: { node: '>=18' } });
          const beforeObserve = this.store.rowsWritten, previousHistory = this.store.history(spec.id + '/latest-version', 1).length;
          this.store.observe({ spec, ...parseSource(spec, raw), observedAt: new Date().toISOString(), hash: await hash(raw), fetchId: crypto.randomUUID(), method: 'isolated-fixture' }, Date.now() + 10000000);
          return Response.json({ revalidation_writes: revalidation, candidate_reads: peek, changed_observation_writes: this.store.rowsWritten - beforeObserve, history_added: this.store.history(spec.id + '/latest-version', 1).length - previousHistory, value: this.store.fact(spec.id + '/latest-version').current_value });
        }
        return super.fetch(request);
      }
    }
    export default { async fetch(request, env) { return env.LIVE_CONTROL.get(env.LIVE_CONTROL.idFromName(controlName)).fetch(request); } };
  ` }, outfile: join(directory, `${name}.mjs`), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: directory, workers: Object.keys(roots).map(name => ({
    name, modules: true, modulesRoot: directory, scriptPath: join(directory, `${name}.mjs`), compatibilityDate: '2026-08-25',
    durableObjects: { LIVE_SHARDS: { className: 'BudgetShard', useSQLite: true }, LIVE_CONTROL: { className: 'LiveControl', useSQLite: true } },
    bindings: { LIVE_SOURCE_FETCHES: 'off', LIVE_BOOTSTRAP: 'off', FIXTURE_AT: String(at) },
    outboundService: () => { throw new Error('External providers are forbidden in this fixture'); },
  })) }));
  await runtime.ready; const measured = {}, catalogues = {};
  const { shardName } = await import('../src/live/util.ts');
  for (const name of Object.keys(roots)) {
    const namespace = await runtime.getDurableObjectNamespace('LIVE_SHARDS', name);
    await Promise.all(Array.from({ length: 32 }, async (_, shard) => {
      const stub = namespace.get(namespace.idFromName(shardName(shard)));
      const response = await stub.fetch('https://fixture.test/', { method: 'POST', body: JSON.stringify({ op: 'fixture-seed', shard }) });
      assert.equal(response.status, 200);
    }));
    const worker = await runtime.getWorker(name), response = await worker.fetch('https://fixture.test/', { method: 'POST', body: JSON.stringify({ op: 'catalog' }) });
    assert.equal(response.status, 200); const catalog = await response.json(); catalogues[name] = catalog;
    const stub = namespace.get(namespace.idFromName(shardName(0)));
    const workload = await stub.fetch('https://fixture.test/', { method: 'POST', body: JSON.stringify({ op: 'fixture-workload' }) });
    measured[name] = { catalog_rows_read: catalog.profile.rows_read, schema_version: catalog.shards[0].stats.schema_version, ...await workload.json() };
    assert.equal(measured[name].history_added, 1); assert.equal(measured[name].value, '2.0.0');
  }
  const changes = catalog => catalog.changes.map(({ fact_id, entity_id, observed_at, previous_value, current_value, label, source_url, source_hash, change_type }) => ({ fact_id, entity_id, observed_at, previous_value, current_value, label, source_url, source_hash, change_type })).sort((a, b) => a.fact_id.localeCompare(b.fact_id));
  assert.deepEqual(changes(catalogues.after), changes(catalogues.before)); assert.equal(catalogues.after.changes.length, 100);
  assert.deepEqual(catalogues.after.search_items, catalogues.before.search_items);
  for (const metric of ['catalog_rows_read', 'revalidation_writes', 'candidate_reads', 'changed_observation_writes']) assert.ok(measured.after[metric] <= measured.before[metric], JSON.stringify({ metric, measured }));
  if (measured.before.schema_version < 4) for (const metric of ['catalog_rows_read', 'revalidation_writes', 'candidate_reads', 'changed_observation_writes']) assert.ok(measured.after[metric] < measured.before[metric], JSON.stringify({ metric, measured }));
  const report = { baseline_sha: process.env.LIVE_BASELINE_SHA || null, scope: 'Paired real workerd SQLite: 32 shards, 2,560 sources and 10,240 facts per build. Same global latest 100 changes and entity catalog. Application SQL counters only; not account-wide billing or a daily availability guarantee.', before: measured.before, after: measured.after, source_fetches: 0, payments: 0 };
  console.log(JSON.stringify(report)); if (process.env.LIVE_SQL_REPORT) await writeFile(process.env.LIVE_SQL_REPORT, JSON.stringify(report, null, 2));
} finally { if (runtime) await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
