import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
const roots = { before: resolve(process.env.LIVE_BASELINE_ROOT), after: fileURLToPath(new URL('../../../', import.meta.url)) };
const directory = await mkdtemp(join(tmpdir(), 'xguard-infra-budget-')); let runtime;
try {
  for (const [name, root] of Object.entries(roots)) await build({ stdin: { resolveDir: root, contents: `
    import { Store } from ${JSON.stringify(join(root, 'apps/relay/src/live/store.ts'))};
    import { sourceSpec, parseSource } from ${JSON.stringify(join(root, 'apps/relay/src/live/adapters.ts'))};
    import { hash } from ${JSON.stringify(join(root, 'apps/relay/src/live/util.ts'))};
    export class Probe {
      constructor(state) { this.state = state; this.store = new Store(state.storage); }
      async fetch() {
        const store = this.store, spec = sourceSpec('npm', 'recovery-fixture');
        const raw = JSON.stringify({ name: spec.identifier, version: '1.0.0', license: 'MIT', engines: { node: '>=18' } });
        store.enqueue(spec); store.observe({ spec, ...parseSource(spec, raw), observedAt: new Date().toISOString(), hash: await hash(raw), fetchId: crypto.randomUUID(), method: 'offline-fixture' }, 0);
        const source = store.one('SELECT * FROM sources WHERE id=?', spec.id);
        const start = store.rowsWritten;
        for (let i=0; i<100; i++) store.revalidated(source, new Date().toISOString(), Date.now()+10000000);
        const revalidation_writes = store.rowsWritten-start, telemetryStart=store.rowsWritten;
        const events = Array.from({length:2048}, (_, i) => ({ id: crypto.randomUUID(), timestamp: new Date().toISOString(), path:'/fact/npm/react/latest-version', status:200, content_type:'application/json', cache:'HIT', classification:'verified-ai', operator:'OpenAI', user_agent:'OAI-SearchBot', bytes:100,latency_ms:5, visitor_hash:'fixture-daily-hash', synthetic:false }));
        if (typeof store.telemetryBatch === 'function') for(let i=0;i<events.length;i+=64) store.telemetryBatch(events.slice(i,i+64));
        else for(const event of events) store.telemetry(event);
        const telemetry_writes=store.rowsWritten-telemetryStart;
        const result={ revalidation_writes, telemetry_writes, recorded_requests:store.metrics().requests.reduce((n,r)=>n+r.requests,0), raw_crawler_samples:store.one('SELECT count(*) AS n FROM crawler_requests').n, fact:store.fact(spec.id+'/latest-version').current_value };
        if(typeof store.telemetryBatch==='function') {
          const capStart=store.rowsWritten;
          for(let i=0;i<2048;i+=64) store.telemetryBatch(events.slice(i,i+64).map((e,j)=>({...e,id:crypto.randomUUID(),path:'/fixture/'+(i+j)})));
          result.budgeted_additional_writes=store.rowsWritten-capStart; result.budget=store.metrics().operational_budget;
        }
        for(let i=0;i<1000;i++) {
          store.run('INSERT INTO crawler_requests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)','expired-'+i,'2000-01-01T00:00:00.000Z','/expired',200,'application/json','HIT','claimed-ai','OpenAI','fixture','','',0,0,'',0);
          store.run('INSERT INTO crawler_visitors VALUES(?,?,?,?)','2000-01-01','expired-'+i,'OpenAI',1);
          store.run('INSERT INTO rate_limits VALUES(?,?,?)','expired-'+String(i).padStart(5,'0'),1,0);
        }
        const immutableBefore=store.one('SELECT count(*) AS n FROM fact_observations').n, cleanupStart=store.rowsWritten;
        store.cleanOperationalData();let cleanupWrites=store.rowsWritten-cleanupStart;
        for(let i=0;i<10;i++){const restarted=new Store(this.state.storage), before=restarted.rowsWritten;restarted.cleanOperationalData();cleanupWrites+=restarted.rowsWritten-before;}
        result.cleanup_writes=cleanupWrites;result.remaining_expired_raw=store.one('SELECT count(*) AS n FROM crawler_requests WHERE timestamp<?','2001-01-01').n;
        result.cleanup_preserved_immutable_observations=store.one('SELECT count(*) AS n FROM fact_observations').n===immutableBefore;
        result.final_operational_budget=store.metrics().operational_budget||null;
        return Response.json(result);
      }
    }
    export default {fetch(request,env){return env.PROBE.get(env.PROBE.idFromName('measurement')).fetch(request);}};
  ` }, outfile: join(directory, name+'.mjs'), bundle:true, format:'esm', platform:'browser', target:'es2022' });
  runtime = new Miniflare(convertV4MiniflareOptions({ host:'127.0.0.1', port:0, workers:Object.keys(roots).map(name=>({name,modules:true,modulesRoot:directory,scriptPath:join(directory,name+'.mjs'),compatibilityDate:'2026-08-25',durableObjects:{PROBE:{className:'Probe',useSQLite:true}},outboundService:()=>{throw Error('No external traffic or financial transaction permitted');}})) }));
  await runtime.ready; const measurements={};
  for(const name of Object.keys(roots)) { const worker=await runtime.getWorker(name); const response=await worker.fetch('https://fixture.test/'); assert.equal(response.status,200); measurements[name]=await response.json(); }
  assert.equal(measurements.before.recorded_requests,2048); assert.equal(measurements.after.recorded_requests,2048);
  assert.equal(measurements.after.fact,measurements.before.fact);
  assert.equal(measurements.after.revalidation_writes,measurements.before.revalidation_writes);
  assert.ok(measurements.after.telemetry_writes<=measurements.before.telemetry_writes);
  if(measurements.before.raw_crawler_samples>measurements.after.raw_crawler_samples) assert.ok(measurements.after.telemetry_writes<measurements.before.telemetry_writes/10);
  assert.ok(measurements.after.budget.rows_written<=500);
  assert.ok(measurements.after.cleanup_preserved_immutable_observations);
  assert.ok(measurements.after.final_operational_budget.rows_written<=500);
  assert.ok(measurements.after.final_operational_budget.cleanup_rows_written<=250);
  assert.ok(measurements.after.final_operational_budget.telemetry_rows_written<=250);
  assert.ok(measurements.after.cleanup_writes<=measurements.before.cleanup_writes);
  if(measurements.before.remaining_expired_raw===0) assert.ok(measurements.after.cleanup_writes<measurements.before.cleanup_writes/10);
  const report={baseline_sha:process.env.LIVE_BASELINE_SHA||null,scope:'Paired real workerd SQLite. 2048 repeat verified-crawler requests, 100 unchanged source revalidations, 3000 expired operational rows and 10 retention restarts. No providers, payments or production load. SQL row counters include indexes and triggers; provider request/alarm/KV billing is excluded.',...measurements,telemetry_write_reduction_percent:100*(1-measurements.after.telemetry_writes/measurements.before.telemetry_writes)};
  console.log(JSON.stringify(report)); if(process.env.INFRA_BUDGET_REPORT) await writeFile(process.env.INFRA_BUDGET_REPORT,JSON.stringify(report,null,2));
} finally {if(runtime)await runtime.dispose();await rm(directory,{recursive:true,force:true});}
