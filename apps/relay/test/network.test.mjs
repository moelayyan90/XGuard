import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeNetwork, resolveRoute, fetchPublic, executeNetwork } from '../src/network/engine.ts';
import { networkState, networkAlarm } from '../src/network/state.ts';
import { paymentCoverage } from '../src/network/payments.ts';

const price = { max_amount_atomic: '30000' };
function durable() {
  const values = new Map(); let alarm = null;
  const storage = { async get(k) { return structuredClone(values.get(k)); }, async put(k,v) { values.set(k,structuredClone(v)); }, async setAlarm(t) { alarm=t; }, async deleteAlarm() { alarm=null; }, async transaction(fn) { return fn(storage); } };
  return { storage, blockConcurrencyWhile: fn=>fn(), values, get alarm(){return alarm;} };
}
const source = async input => ({ ok: true, status: 200, final_url: input.url, data: input.url.endsWith('/robots.txt') ? '' : '<html><title>Evidence</title><main>Useful text</main></html>', source:{retrieved_at:new Date().toISOString()}, body_sha256:'a'.repeat(64) });
test('all task spend, recurrence, input and public URL bounds apply before payment',()=>{
  const base={...price,budget_atomic:'30000',steps:[{kind:'http',url:'https://example.com/'}]};
  assert.equal(normalizeNetwork('task',base).runs,1);
  for(const change of [{budget_atomic:'1'},{steps:Array(4).fill(base.steps[0])},{steps:[{kind:'http',url:'https://127.0.0.1/'}]},{steps:[{kind:'http',url:'https://user:secret@example.com/'}]},{steps:[{kind:'http',url:'https://example.com/',depends_on:[0]}]},{run_at:new Date().toISOString()},{op:'untrusted-internal-operation'}]) assert.throws(()=>normalizeNetwork('task',{...base,...change}));
  assert.throws(()=>normalizeNetwork('schedule',{...base,runs:3,interval_seconds:1}));
  assert.throws(()=>normalizeNetwork('schedule',{...base,steps:[...base.steps,...base.steps],runs:3,interval_seconds:60}));
  assert.throws(()=>normalizeNetwork('fact',{kind:'npm-version',identifier:'../private',...price}));
});
test('unmatched and external intents never claim executable or measured success',async()=>{
  const no=await resolveRoute({intent:'Invent an entirely unsupported capability'});assert.equal(no.executable,false);assert.equal(no.expected_success_probability,null);assert.equal(no.routes.length,4);
  const external=await resolveRoute({intent:'Deploy hosting and database'});assert.equal(external.executable,false);assert.equal(external.estimated_total_cost_atomic,null);assert.ok(external.steps.every(s=>s.current_health==='UNKNOWN'));
  const supported=await resolveRoute({intent:'Extract a website'});assert.equal(supported.executable,true);
});
test('robots denial prevents source access and redirects stay restricted',async()=>{
  const calls=[];
  await assert.rejects(fetchPublic('https://example.com/private',async input=>{calls.push(input.url);return {...await source(input),data:'User-agent: *\nDisallow: /private'};}),/robots_disallowed/);
  assert.deepEqual(calls,['https://example.com/robots.txt']);
  await fetchPublic('https://example.com/',async input=>{assert.equal(input.same_origin_only,true);return source(input);});
});
test('durable tasks keep completed steps across restart, fail over, and reject token guessing',async()=>{
  const state=durable(),input=normalizeNetwork('task',{...price,budget_atomic:'30000',steps:[{kind:'http',url:'https://example.com/first'},{kind:'http',url:'https://example.com/fail',fallback_url:'https://example.com/backup'}]});
  const created=await(await networkState(state,'/network/create',{input,task_id:'xgtask_'+'a'.repeat(32),payment_identifier:'pay_fixture'})).json();
  const token=created.task_token;
  assert.equal((await networkState(state,'/network/status',{token:'guessed'})).status,404);
  let first=0,failed=0;
  const fetcher=async input=>{if(input.url.endsWith('/first'))first++;if(input.url.endsWith('/fail')){failed++;return {...await source(input),status:503,ok:false};}return source(input);};
  await networkAlarm(state,fetcher);
  assert.equal(state.values.get('network:task').current_step,1);
  const restarted={storage:state.storage,blockConcurrencyWhile:fn=>fn()};
  await networkAlarm(restarted,fetcher);assert.equal(state.values.get('network:task').status,'PENDING');
  await networkAlarm(restarted,fetcher);
  const done=await(await networkState(restarted,'/network/status',{token})).json();
  assert.equal(done.status,'COMPLETED');assert.equal(done.checkpoints.length,2);assert.equal(done.provider_switches,1);assert.equal(first,1);assert.equal(failed,1);assert.equal(done.task_token,undefined);assert.equal(state.alarm,null);
  assert.equal((await networkState(restarted,'/network/resume',{token})).status,409);
});
test('quota exhaustion has a bounded retry budget and a visible dead letter',async()=>{
  const state=durable(),input=normalizeNetwork('task',{...price,budget_atomic:'30000',steps:[{kind:'http',url:'https://example.com/limited'}]});
  await networkState(state,'/network/create',{input,task_id:'xgtask_'+'b'.repeat(32),payment_identifier:'pay_limit'});
  const fetcher=async input=>input.url.endsWith('/robots.txt')?source(input):({...await source(input),status:429,ok:false});
  await networkAlarm(state,fetcher);assert.equal(state.values.get('network:task').status,'WAITING_FOR_QUOTA');
  await networkAlarm(state,fetcher);await networkAlarm(state,fetcher);
  const task=state.values.get('network:task');assert.equal(task.status,'FAILED');assert.equal(task.dead_letter.attempts,3);assert.equal(state.alarm,null);
});
test('task creation needs actual settled operation context; financial eligibility remains explicit',async()=>{
  const input=normalizeNetwork('task',{...price,budget_atomic:'30000',steps:[{kind:'http',url:'https://example.com/'}]});
  await assert.rejects(executeNetwork(input,{},source),/settled_payment_context_required/);
  const coverage=paymentCoverage({});assert.equal(coverage.receiving[0].configured,false);assert.equal(coverage.fx.enabled,false);assert.equal(coverage.owner_money.settled,null);assert.equal(coverage.protection.enabled,false);assert.equal(coverage.deferred_compute.enabled,false);
});
test('global graph refresh is bounded, backed off and separate from private task records',async()=>{
  const state=durable();
  const first=await(await networkState(state,'/network/graph-claim',{})).json();assert.equal(first.services.length,3);
  assert.equal((await(await networkState(state,'/network/graph-claim',{})).json()).services.length,0);
  await networkState(state,'/network/graph-record',{record:{id:first.services[0].id,source_hash:'a',verification:'DOCUMENTATION_REACHABLE'}});
  await networkState(state,'/network/graph-record',{record:{id:first.services[0].id,source_hash:'b',verification:'DOCUMENTATION_REACHABLE'}});
  const graph=await(await networkState(state,'/network/graph-read',{})).json();assert.equal(graph.history.length,1);assert.equal(graph.records[first.services[0].id].source_hash,'b');assert.equal(state.values.has('network:task'),false);
  assert.equal((await networkState(state,'/network/graph-record',{record:{id:'untrusted-self-promoted-provider'}})).status,400);
});
