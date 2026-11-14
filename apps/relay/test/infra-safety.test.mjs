import test from 'node:test';
import assert from 'node:assert/strict';
import { PaidGatewayState } from '../src/paid-agent-entry.js';
import { c2spWitnessRoute } from '../src/c2sp-witness.js';
import live from '../src/live/worker.ts';
import { environment, seed } from './live-harness.mjs';
import { Store } from '../src/live/store.ts';
import { storage as sqlStorage } from './live-harness.mjs';

class SerializedStorage {
  values = new Map(); writes = 0; alarms = 0; chain = Promise.resolve();
  async get(k) { return structuredClone(this.values.get(k)); }
  async put(k,v) { this.writes++; this.values.set(k,structuredClone(v)); }
  async delete(k) { this.writes++; this.values.delete(k); }
  async setAlarm() { this.alarms++; }
  transaction(fn) { const p=this.chain.then(()=>fn(this));this.chain=p.catch(()=>{});return p; }
}
const post=(path,body)=>new Request('https://fixture.test'+path,{method:'POST',body:JSON.stringify(body)});
test('concurrent rate admission saturates durably and repeated rejection performs no writes',async()=>{
  const storage=new SerializedStorage(), state={storage};
  const body={scope:'fixture',subject_hash:'a'.repeat(64),limit:30};
  const app=new PaidGatewayState(state,{});
  const responses=await Promise.all(Array.from({length:120},()=>app.fetch(post('/index/rate',body))));
  assert.equal(responses.filter(r=>r.status===200).length,30);
  assert.equal(responses.filter(r=>r.status===429).length,90);
  const writes=storage.writes, restarted=new PaidGatewayState(state,{});
  for(let i=0;i<100;i++) assert.equal((await restarted.fetch(post('/index/rate',body))).status,429);
  assert.equal(storage.writes,writes);assert.equal(writes,31);
});
test('all journal events remain durable while the cleanup alarm is scheduled once',async()=>{
  const storage=new SerializedStorage(),app=new PaidGatewayState({storage},{});
  for(const event of ['request_received','payment_required','payment_attempt','settlement_success','execution_success']) {
    const r=await app.fetch(post('/journal/append',{event,request_id:'xgr_fixture',traffic_class:'external'}));assert.equal(r.status,200);
  }
  const journal=await storage.get('journey:v1');assert.equal(journal.events.length,5);assert.equal(storage.alarms,1);assert.equal(journal.complete,true);
});
test('public read bursts share an authoritative read without sharing private or payment state',async()=>{
  const h=environment();try {
    await seed(h);const ns=h.env.LIVE_SHARDS;let calls=0;
    h.env.LIVE_SHARDS={...ns,get(id){const stub=ns.get(id);return{async fetch(r){const body=await r.clone().json();if(body.op==='fact-page'){calls++;await new Promise(resolve=>setTimeout(resolve,10));}return stub.fetch(r);}};}};
    const responses=await Promise.all(Array.from({length:50},()=>live.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version',{headers:{accept:'application/json','user-agent':'XGuardLive-offline-load'}}),h.env,h.ctx)));
    assert.equal(calls,1);
    for(const r of responses){assert.equal(r.status,200);assert.equal((await r.json()).fact.current_value,'1.0.0');}
  }finally{await h.drain();h.close();}
});
test('unknown witness paths do not touch state and provider failures remain controlled',async()=>{
  let calls=0;const env={C2SP_WITNESS:{idFromName:x=>x,get(){calls++;return{fetch:async()=>{throw Error('provider quota');}};}}};
  assert.equal((await c2spWitnessRoute(new Request('https://api.xguardgate.com/witness/v0/status'),env)).status,404);assert.equal(calls,0);
  assert.equal((await c2spWitnessRoute(new Request('https://api.xguardgate.com/witness'),env)).status,503);
});
test('an old release budget is never reset or overspent by the new retention allocation',()=>{
  const db=sqlStorage(),store=new Store(db);try{
    const old={day:new Date().toISOString().slice(0,10),rows_written:499,dropped_events:0,alert:90};
    store.set('operational-telemetry-budget-v1',old);
    store.run('INSERT INTO rate_limits VALUES(?,?,?)','expired-fixture',1,0);
    const changes=db.db.prepare('SELECT total_changes() AS n').get().n;
    store.cleanOperationalData();store.cleanOperationalData();
    assert.equal(db.db.prepare('SELECT total_changes() AS n').get().n,changes);
    assert.deepEqual(store.get('operational-telemetry-budget-v1'),old);
  }finally{db.db.close();}
});
test('collection capacity survives restart, defers writes before mutation and leaves public facts readable',async()=>{
  const h=environment();try{
    const {store,spec}=await seed(h),day=new Date().toISOString().slice(0,10);
    store.set('source-write-budget-v1',{day,rows_written:1590,allocation:1600,limit:1600,paused:false});
    assert.throws(()=>store.collectionWrite(20,()=>store.set('must-not-exist',true)),/capacity_deferred/);
    assert.equal(store.get('must-not-exist'),null);
    const restarted=new Store(store.storage);
    assert.equal(restarted.collectionBudget().paused,true);
    assert.throws(()=>restarted.collectionWrite(1,()=>store.set('must-not-exist',true)),/capacity_deferred/);
    assert.equal(restarted.fact(spec.id+'/latest-version').current_value,'1.0.0');
    const tomorrow=Date.parse(day+'T00:00:00Z')+86400000+1000;
    assert.equal(restarted.collectionBudget(tomorrow).paused,false);
    assert.ok(restarted.collectionBudget(tomorrow).allocation<1600);
    assert.equal((await live.fetch(new Request('https://xguardgate.com/fact/npm/react/latest-version'),h.env,h.ctx)).status,200);
    for(const path of ['/readyz','/a2a/health']){
      const response=await live.fetch(new Request('https://xguardgate.com'+path),h.env,h.ctx);
      assert.equal(response.status,200);assert.ok(response.headers.get('cache-control').includes('no-store'));
      const head=await live.fetch(new Request('https://xguardgate.com'+path,{method:'HEAD'}),h.env,h.ctx);
      assert.equal(head.status,200);assert.equal(await head.text(),'');
    }
  }finally{await h.drain();h.close();}
});
test('first deployment reserves headroom for old writes and a later UTC day receives its normal allocation',()=>{
  const db=sqlStorage();try{
    const store=new Store(db),noon=Date.parse('2030-01-02T12:00:00Z');
    assert.equal(store.collectionBudget(noon).allocation,600);
    store.set('source-write-budget-v1',{day:'2030-01-01',rows_written:1600,allocation:1600,limit:1600,paused:true});
    assert.equal(store.collectionBudget(noon).allocation,800);
    assert.equal(store.collectionBudget(noon).paused,false);
  }finally{db.db.close();}
});
