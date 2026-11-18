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
          // Materialize the same catalog at every CI wall-clock time. Source
          // admission limits are exercised separately by source-capacity-workerd;
          // this fixture measures SQL indexes, reads and observation writes.
          this.store.set('source-write-budget-v1', { day: new Date().toISOString().slice(0, 10), rows_written: 0, allocation: 1600, limit: 1600, paused: false });
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
        if (body.op === 'fixture-previews') {
          const spec = sourceSpec('npm', 'budget-preview'), factId = spec.id + '/latest-version';
          this.store.enqueue(spec);
          for (let i = 0; i < 115; i++) {
            const observedAt = new Date(Number(this.env.FIXTURE_AT) - (115 - i) * 1000).toISOString();
            this.store.observe({ spec, facts: [{ key: 'latest-version', label: 'Latest release', value: String(i) }], related: [], exhaustive: true, observedAt, hash: await hash(String(i)), fetchId: crypto.randomUUID(), method: 'isolated-fixture' }, 0);
          }
          const measure = async (op, id) => {
            const start = this.store.rowsRead;
            const preview = await (await super.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify({ op, id }) }))).json();
            return [preview, this.store.rowsRead - start];
          };
          const [fact, factReads] = await measure('fact-page', factId);
          const [entity, entityReads] = await measure('entity-page', spec.id);
          const history = this.store.history(factId, 1), changes = this.store.changes(spec.id);
          return Response.json({
            fact_preview_reads: factReads, entity_preview_reads: entityReads,
            fact_preview_matches: JSON.stringify(fact.history.map(row => row.id)) === JSON.stringify(history.slice(0, 10).map(row => row.id)),
            entity_preview_matches: JSON.stringify(entity.changes.map(row => row.id)) === JSON.stringify(changes.slice(0, 8).map(row => row.id)),
            history_page_sizes: [history.length, this.store.history(factId, 2).length],
          });
        }
        if (body.op === 'fixture-repeat-reads') {
          const id = 'npm/budget-0-000/latest-version', start = this.store.rowsRead;
          const requestFor = op => new Request(request.url, { method: 'POST', body: JSON.stringify({ op, id }) });
          let first, same = true;
          for (let i = 0; i < 128; i++) {
            const value = await (await super.fetch(requestFor('fact'))).json();
            if (!first) first = value; else if (JSON.stringify(first) !== JSON.stringify(value)) same = false;
          }
          const reads = this.store.rowsRead - start;
          const beforePaid = this.store.rowsRead;
          for (let i = 0; i < 2; i++) await super.fetch(new Request(request.url, { method: 'POST', body: JSON.stringify({ op: 'paid-read', kind: 'batch', facts: [id] }) }));
          return Response.json({ repeated_public_reads: reads, identical_public_values: same, paid_reads_uncached: this.store.rowsRead - beforePaid });
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
    const previews = await stub.fetch('https://fixture.test/', { method: 'POST', body: JSON.stringify({ op: 'fixture-previews' }) });
    const repeats = await stub.fetch('https://fixture.test/', { method: 'POST', body: JSON.stringify({ op: 'fixture-repeat-reads' }) });
    measured[name] = { catalog_rows_read: catalog.profile.rows_read, schema_version: catalog.shards[0].stats.schema_version, ...await workload.json(), ...await previews.json(), ...await repeats.json() };
    assert.equal(measured[name].history_added, 1); assert.equal(measured[name].value, '2.0.0');
    assert.equal(measured[name].fact_preview_matches, true);
    assert.equal(measured[name].entity_preview_matches, true);
    assert.deepEqual(measured[name].history_page_sizes, [100, 15]);
    assert.equal(measured[name].identical_public_values, true);
  }
  const changes = catalog => catalog.changes.map(({ fact_id, entity_id, observed_at, previous_value, current_value, label, source_url, source_hash, change_type }) => ({ fact_id, entity_id, observed_at, previous_value, current_value, label, source_url, source_hash, change_type })).sort((a, b) => a.fact_id.localeCompare(b.fact_id));
  assert.deepEqual(changes(catalogues.after), changes(catalogues.before)); assert.equal(catalogues.after.changes.length, 100);
  assert.deepEqual(catalogues.after.search_items, catalogues.before.search_items);
  for (const metric of ['catalog_rows_read', 'revalidation_writes', 'candidate_reads', 'changed_observation_writes']) assert.ok(measured.after[metric] <= measured.before[metric], JSON.stringify({ metric, measured }));
  for (const metric of ['fact_preview_reads', 'entity_preview_reads']) assert.ok(measured.after[metric] <= measured.before[metric], JSON.stringify({ metric, measured }));
  assert.ok(measured.after.repeated_public_reads <= measured.before.repeated_public_reads, JSON.stringify(measured));
  // Once the base already has this cache, require no regression rather than a
  // fresh 90% improvement from every subsequent unrelated release.
  if (measured.before.repeated_public_reads >= 128) assert.ok(measured.after.repeated_public_reads < measured.before.repeated_public_reads / 10, JSON.stringify(measured));
  assert.equal(measured.after.paid_reads_uncached, measured.before.paid_reads_uncached);
  if (measured.before.schema_version < 4) for (const metric of ['catalog_rows_read', 'revalidation_writes', 'candidate_reads', 'changed_observation_writes']) assert.ok(measured.after[metric] < measured.before[metric], JSON.stringify({ metric, measured }));
  const report = { baseline_sha: process.env.LIVE_BASELINE_SHA || null, scope: 'Paired real workerd SQLite: 32 shards, 2,560 sources and 10,240 facts per build. Same global latest 100 changes and entity catalog. Application SQL counters only; not account-wide billing or a daily availability guarantee.', before: measured.before, after: measured.after, source_fetches: 0, payments: 0 };
  console.log(JSON.stringify(report)); if (process.env.LIVE_SQL_REPORT) await writeFile(process.env.LIVE_SQL_REPORT, JSON.stringify(report, null, 2));
} finally { if (runtime) await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
