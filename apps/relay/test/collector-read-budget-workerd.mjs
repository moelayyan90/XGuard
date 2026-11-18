import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

assert.ok(process.env.LIVE_BASELINE_ROOT, 'An exact source baseline is required');
const roots = { before: resolve(process.env.LIVE_BASELINE_ROOT), after: fileURLToPath(new URL('../../../', import.meta.url)) };
const dir = await mkdtemp(join(tmpdir(), 'xguard-collector-reads-')); let runtime;
try {
  for (const [name, root] of Object.entries(roots)) await build({ stdin: { resolveDir: root, contents: `
    import { LiveShard } from ${JSON.stringify(join(root, 'apps/relay/src/live/objects.ts'))};
    import { Store } from ${JSON.stringify(join(root, 'apps/relay/src/live/store.ts'))};
    import { sourceSpec } from ${JSON.stringify(join(root, 'apps/relay/src/live/adapters.ts'))};
    export class LeaseControl { async fetch() { return Response.json({retry_after_ms:300000}); } }
    export class Probe extends LiveShard {
      async fetch() {
        const day = new Date().toISOString().slice(0,10), midnight = Date.parse(day+'T00:00:00Z');
        this.store.set('source-write-budget-v1',{day,rows_written:0,allocation:1600,limit:1600,paused:false});
        this.store.set('source-read-budget-v1',{day,rows_read:0,allocation:4500,limit:100000,paused:false});
        // Equal pre-existing source data; source admission has its own fixture.
        for(let i=0;i<80;i++) {
          const spec=sourceSpec('npm','collector-fixture-'+i);
          this.store.run('INSERT INTO sources(id,spec_json,domain,last_interval) VALUES(?,?,?,?)',spec.id,JSON.stringify(spec),spec.domain,spec.interval);
          if(i===0)this.store.observe({spec,facts:[{key:'latest-version',label:'Latest version',value:'1.0.0'}],related:[],exhaustive:true,observedAt:new Date().toISOString(),hash:'a'.repeat(64),fetchId:'fixture',method:'offline-fixture'},0);
        }
        const start=this.store.rowsRead,writes=this.store.rowsWritten;
        for(let i=0;i<64;i++){await this.state.storage.deleteAlarm();await this.alarm();}
        const measured={alarm_reads:this.store.rowsRead-start,alarm_writes:this.store.rowsWritten-writes};
        const budget=this.store.get('source-read-budget-v1'),alarm=await this.state.storage.getAlarm();
        this.store=new Store(this.state.storage);
        const persisted=this.store.get('source-read-budget-v1');
        const beforePaused=this.store.rowsWritten;
        if(persisted.paused){await this.state.storage.deleteAlarm();await this.alarm();}
        const pausedWrites=this.store.rowsWritten-beforePaused;
        const id='npm/collector-fixture-0/latest-version',fact=this.store.fact(id);
        const paidStart=this.store.rowsRead;
        for(let i=0;i<2;i++)await super.fetch(new Request('https://fixture.test/',{method:'POST',body:JSON.stringify({op:'paid-read',kind:'batch',facts:[id]})}));
        const paidReads=this.store.rowsRead-paidStart;
        const supports=typeof this.store.collectionReadBudget==='function';
        const reset=supports?this.store.collectionReadBudget(midnight+86400000+1000):null;
        let invalidClosed=null;
        if(supports){this.store.set('source-read-budget-v1',{day,rows_read:-1,allocation:4500,paused:false});invalidClosed=this.store.collectionReadBudget().paused;}
        return Response.json({...measured,budget,persisted,paused_writes:pausedWrites,alarm,utc_reset:midnight+86400000,reset,invalid_closed:invalidClosed,read_budget_supported:supports,public_value:fact.current_value,history_count:this.store.history(id,1).length,paid_reads:paidReads});
      }
    }
    export default {fetch(request,env){return env.PROBE.get(env.PROBE.idFromName('measurement')).fetch(request);}};
  ` }, outfile: join(dir, name + '.mjs'), bundle: true, format: 'esm', platform: 'browser', target: 'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: Object.keys(roots).map(name => ({
    name, modules: true, modulesRoot: dir, scriptPath: join(dir, name + '.mjs'), compatibilityDate: '2026-08-25',
    durableObjects: { PROBE: { className: 'Probe', useSQLite: true }, LIVE_CONTROL: { className: 'LeaseControl', useSQLite: true } },
    bindings: { LIVE_SOURCE_FETCHES: 'on' }, outboundService: () => { throw Error('No external or financial traffic permitted'); },
  })) }));
  await runtime.ready; const measured = {};
  for (const name of Object.keys(roots)) {
    const response = await (await runtime.getWorker(name)).fetch('https://fixture.test/');
    assert.equal(response.status, 200); measured[name] = await response.json();
    assert.equal(measured[name].public_value, '1.0.0'); assert.equal(measured[name].history_count, 1);
  }
  assert.equal(measured.after.budget.paused, true);
  assert.deepEqual(measured.after.budget, measured.after.persisted);
  assert.equal(measured.after.paused_writes, 0);
  assert.ok(measured.after.alarm >= measured.after.utc_reset);
  assert.equal(measured.after.reset.paused, false); assert.equal(measured.after.reset.rows_read, 0);
  assert.equal(measured.after.invalid_closed, true);
  assert.equal(measured.after.paid_reads, measured.before.paid_reads);
  assert.ok(measured.after.alarm_reads <= measured.before.alarm_reads);
  if (!measured.before.read_budget_supported) assert.ok(measured.after.alarm_reads < measured.before.alarm_reads / 5);
  const report = { baseline_sha: process.env.LIVE_BASELINE_SHA || null, scope: 'Paired real workerd SQLite; 80 equally seeded sources, 64 forced contended collector alarms, a 4500-row test allocation and persistent restart. Not account-wide billing or a production-volume guarantee.', ...measured, external_requests: 0, payments: 0 };
  console.log(JSON.stringify(report));
  if (process.env.COLLECTOR_READ_REPORT) await writeFile(process.env.COLLECTOR_READ_REPORT, JSON.stringify(report, null, 2) + '\n');
} finally { if (runtime) await runtime.dispose(); await rm(dir, { recursive: true, force: true }); }
