import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const root=fileURLToPath(new URL('../../../',import.meta.url));
const dir = await mkdtemp(join(tmpdir(), 'xguard-source-capacity-')); let runtime;
try {
  const scriptPath = join(dir, 'probe.js');
  await build({stdin:{resolveDir:root,contents:`
    import { Store } from ${JSON.stringify(resolve(root,'apps/relay/src/live/store.ts'))};
    import { sourceSpec, parseSource } from ${JSON.stringify(resolve(root,'apps/relay/src/live/adapters.ts'))};
    import { hash } from ${JSON.stringify(resolve(root,'apps/relay/src/live/util.ts'))};
    export class Probe {
      constructor(state) {this.state=state;}
      async fetch() {
        let store=new Store(this.state.storage);
        const spec=sourceSpec('npm','source-capacity-fixture'),day=new Date().toISOString().slice(0,10);
        store.set('source-write-budget-v1',{day,rows_written:0,allocation:1600,limit:1600,paused:false});
        const start=store.rowsWritten, reservations=[];
        store.enqueue(spec);
        const raw=JSON.stringify({name:spec.identifier,version:'1.0.0',license:'MIT',engines:{node:'>=18'},dependencies:Object.fromEntries(Array.from({length:30},(_,i)=>['fixture-'+i,'1.0.0']))});
        const parsed=parseSource(spec,raw),digest=await hash(raw),n=parsed.facts.length;
        const observeReserve=128+24*n+parsed.related.length*3,before=store.rowsWritten;
        store.collectionWrite(observeReserve,()=>{store.observe({spec,...parsed,observedAt:new Date().toISOString(),hash:digest,fetchId:crypto.randomUUID(),method:'offline-fixture'},0);store.fetchLog(spec,crypto.randomUUID(),200,raw.length,1,digest,null);});
        reservations.push({operation:'observe-with-30-relations',writes:store.rowsWritten-before-2,reserve:observeReserve});
        const source=store.one('SELECT * FROM sources WHERE id=?',spec.id),observation=store.one('SELECT observation_id FROM current_facts WHERE id=?',spec.id+'/latest-version').observation_id;
        let admitted=0;
        for(let i=0;i<1000;i++) {
          const b=store.rowsWritten;
          try {store.collectionWrite(40+n*6,()=>{store.revalidated(source,new Date().toISOString(),Date.now()+86400000);store.fetchLog(source,crypto.randomUUID(),304,0,1,digest,null);}); admitted++;}
          catch(error){if(error.message!=='source_collection_capacity_deferred')throw error;break;}
          if(i===0) reservations.push({operation:'revalidation-and-log',writes:store.rowsWritten-b-2,reserve:40+n*6});
        }
        const budget=store.collectionBudget(),writes=store.rowsWritten-start;
        const pausedStart=store.rowsWritten;
        for(let i=0;i<20;i++) {
          store=new Store(this.state.storage);
          try{store.collectionWrite(1,()=>store.set('must-not-exist',true));}catch(error){if(error.message!=='source_collection_capacity_deferred')throw error;}
        }
        const after=store.fact(spec.id+'/latest-version');
        return Response.json({writes,admitted,budget,reservations,paused_restart_writes:store.rowsWritten,public_value:after.current_value,immutable_observation_preserved:store.one('SELECT observation_id FROM current_facts WHERE id=?',spec.id+'/latest-version').observation_id===observation,forbidden_write:store.get('must-not-exist'),reset_budget:store.collectionBudget(Date.parse(day+'T00:00:00Z')+86400000+1000)});
      }
    }
    export default {fetch(request,env){return env.PROBE.get(env.PROBE.idFromName('measurement')).fetch(request);}};
  `},bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:scriptPath});
  runtime=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{name:'source-capacity',modules:true,modulesRoot:dir,scriptPath,compatibilityDate:'2026-08-25',durableObjects:{PROBE:{className:'Probe',useSQLite:true}},outboundService:()=>{throw Error('No production or financial network traffic permitted');}}]}));
  await runtime.ready;const r=await runtime.dispatchFetch('https://fixture.test/');assert.equal(r.status,200);const result=await r.json();
  assert.ok(result.admitted>10);assert.ok(result.writes<=1600);assert.ok(result.budget.rows_written>=result.writes);assert.ok(result.budget.rows_written<=1600);
  assert.equal(result.budget.paused,true);assert.equal(result.paused_restart_writes,0);assert.equal(result.forbidden_write,null);
  assert.equal(result.public_value,'1.0.0');assert.equal(result.immutable_observation_preserved,true);assert.equal(result.reset_budget.paused,false);
  for(const x of result.reservations)assert.ok(x.writes<=x.reserve,JSON.stringify(x));
  console.log(JSON.stringify({scope:'Real isolated workerd SQLite, including indexes, triggers, persistent budget and 20 Store restarts. No external requests or payments.',...result}));
  if(process.env.SOURCE_BUDGET_REPORT)await writeFile(process.env.SOURCE_BUDGET_REPORT,JSON.stringify(result,null,2)+'\n');
}finally{if(runtime)await runtime.dispose();await rm(dir,{recursive:true,force:true});}
