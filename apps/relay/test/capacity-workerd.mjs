import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
const directory = await mkdtemp(join(tmpdir(), 'xguard-demand-budget-'));
let runtime;
try {
  const scriptPath = join(directory, 'probe.js');
  await build({ stdin: { resolveDir: process.cwd(), contents: `
    import { Store } from ${JSON.stringify(resolve('apps/relay/src/live/store.ts'))};
    import { catalogCapacity } from ${JSON.stringify(resolve('apps/relay/src/live/capacity.ts'))};
    export class Probe {
      constructor(state) { this.state = state; this.store = new Store(state.storage); }
      async fetch() {
        const today = new Date().toISOString().slice(0,10), yesterday = new Date(Date.now()-86400000).toISOString().slice(0,10);
        this.state.storage.transactionSync(() => {
          for (const day of [yesterday,today]) for (let i=0;i<4096;i++) this.store.run('INSERT OR IGNORE INTO request_metrics VALUES(?,?,?,?,?,?,?,?,?)',day,'/live/npm/probe-'+i,'','unclassified',200,'MISS',3,0,0);
        });
        const start = this.store.rowsRead;
        const previous = this.store.one('SELECT sum(requests) AS n FROM request_metrics WHERE path=? AND day>=?','/live/npm/probe-2048',yesterday).n;
        const before = this.store.rowsRead-start, next = this.store.rowsRead;
        const current = this.store.recentDemand('/live/npm/probe-2048');
        return Response.json({ before_rows_read:before, after_rows_read:this.store.rowsRead-next, previous, current, catalog:catalogCapacity(51188) });
      }
    }
    export default {fetch(request,env) {return env.PROBE.get(env.PROBE.idFromName('measurement')).fetch(request);}};
  ` }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', outfile: scriptPath });
  runtime = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ name: 'capacity-probe', modules: true, modulesRoot: directory, scriptPath, compatibilityDate: '2026-08-25', durableObjects: { PROBE: { className: 'Probe', useSQLite: true } }, outboundService: () => { throw Error('Network forbidden'); } }] }));
  await runtime.ready;
  const response = await runtime.dispatchFetch('https://fixture.test/'); assert.equal(response.status, 200);
  const result = await response.json(); assert.equal(result.previous, 6); assert.equal(result.current, result.previous);
  assert.ok(result.before_rows_read >= 8192); assert.ok(result.after_rows_read <= 8, JSON.stringify(result));
  assert.ok(result.after_rows_read < result.before_rows_read / 100);
  console.log(JSON.stringify({ ...result, scope: 'Isolated real workerd SQLite, 8192 request-metric rows. Exact same source demand. Catalog projection uses the previously recorded 51188-read fixture; not live account usage or a guarantee of uptime.', source_fetches: 0, payments: 0 }));
} finally { if (runtime) await runtime.dispose(); await rm(directory, { recursive: true, force: true }); }
