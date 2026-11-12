import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { auditStability, createAuditGet, MONITOR_URL, STATUS_URL } from './c2sp-stability-contract.mjs';

const fixture = JSON.parse(readFileSync(new URL('../apps/relay/test/fixtures/gblin-public-214.json', import.meta.url)));
function endpoints() {
  const status = { size:214,root:fixture.checkpoint.split('\n')[2],verifier_key:fixture.metadata.verifier_key,storage_read:'ok',recent_growth:[],observed_growth_events:0 };
  return new Map([
    ['https://api.xguardgate.com/witness',JSON.stringify({...fixture.metadata,identity_policy:'pinned_existing_production_key'})],
    ['https://api.xguardgate.com/witness/verifier-key',fixture.metadata.verifier_key+'\n'],
    ['https://mcp.gblin.digital/log/checkpoint',fixture.checkpoint],
    ['https://mcp.gblin.digital/log/witnesses',JSON.stringify(fixture.witnesses)],
    [MONITOR_URL,fixture.checkpoint],[STATUS_URL,JSON.stringify(status)],
    ...Object.entries(fixture.consistency).map(([range,proof])=>{const[old,next]=range.split(':');return[`https://mcp.gblin.digital/log/consistency?old=${old}&new=${next}`,JSON.stringify(proof)];}),
  ]);
}
const get = map => async url => { assert.ok(map.has(url),'only pinned read URLs'); const body=map.get(url); return body instanceof Response ? body : new Response(body,{headers:{'content-type':body.startsWith('{')?'application/json':'text/plain'}}); };
test('GET-only audit verifies public signatures and log growth without inventing witness deliveries',async()=>{
  const result=await auditStability({get:get(endpoints())});
  assert.equal(result.result,'passed');assert.equal(result.latest_size,214);assert.equal(result.xguard_cosignatures_verified_independently,true);
  assert.deepEqual(result.log_only_growth.map(x=>x.size),[213,214]);assert.deepEqual(result.observed_distinct_growth_sizes_after_212,[]);
  assert.equal(result.several_witness_growth_events_proven,false);assert.equal(result.financial_settlements_submitted,0);
});
test('a substituted production identity is rejected even if metadata and key endpoint agree',async()=>{
  const m=endpoints(), meta={...fixture.metadata,verifier_key:fixture.metadata.verifier_key.replace('4cbdcb41','00000000')};
  m.set('https://api.xguardgate.com/witness',JSON.stringify(meta));m.set('https://api.xguardgate.com/witness/verifier-key',meta.verifier_key);
  await assert.rejects(auditStability({get:get(m)}),/identity is pinned/);
});
test('tampered checkpoint and cosignature are rejected independently',async()=>{
  for(const own of [false,true]) {
    const m=endpoints();let note=fixture.checkpoint;
    if(!own)note=note.replace('\n214\n','\n213\n');
    else {const lines=note.split('\n'),i=lines.findIndex(x=>x.startsWith('— xguardgate.com/witness '));const wire=Buffer.from(lines[i].split(' ').at(-1),'base64');wire[75]^=1;lines[i]='— xguardgate.com/witness '+wire.toString('base64');note=lines.join('\n');}
    m.set('https://mcp.gblin.digital/log/checkpoint',note);await assert.rejects(auditStability({get:get(m)}));
  }
});
test('upstream lag/error, monitor mismatch and unavailable state cannot pass as healthy',async()=>{
  for(const field of ['cosigned_size','last_error','monitor','status']) {
    const m=endpoints(),roster=structuredClone(fixture.witnesses),entry=roster.witnesses.find(x=>x.witness==='xguardgate.com/witness');
    if(field==='cosigned_size')entry.cosigned_size=213;
    if(field==='last_error')entry.last_error='HTTP 503';
    m.set('https://mcp.gblin.digital/log/witnesses',JSON.stringify(roster));
    if(field==='monitor')m.set(MONITOR_URL,fixture.checkpoint.replace('\n214\n','\n213\n'));
    if(field==='status')m.set(STATUS_URL,new Response('unavailable',{status:503}));
    await assert.rejects(auditStability({get:get(m)}));
  }
});
test('missing historical status is explicit before upgrade and mandatory for the deployed release',async()=>{
  const m=endpoints();m.set(STATUS_URL,new Response('not found',{status:404}));
  await assert.rejects(auditStability({get:get(m)}));
  const n=endpoints();n.set(STATUS_URL,new Response('not found',{status:404}));
  const report=await auditStability({get:get(n),requireStatus:false});assert.equal(report.history_status,null);assert.equal(report.several_witness_growth_events_proven,false);
});
test('oversized protocol evidence is bounded before parsing',async()=>{
  const m=endpoints();m.set('https://api.xguardgate.com/witness','x'.repeat(131073));
  await assert.rejects(auditStability({get:get(m)}),/bounded public evidence/);
});
test('candidate transport uses a quoted Cloudflare structured field only on XGuard requests',async()=>{
  const calls=[],candidate='42a18e26-165b-4226-9e6a-0dbc8b8b2702';
  const request=createAuditGet({candidate,fetchImpl:async(url,init)=>{calls.push({url,init});return new Response('ok');}});
  await request('https://api.xguardgate.com/witness');
  await request('https://mcp.gblin.digital/log/checkpoint');
  assert.equal(new Headers(calls[0].init.headers).get('cloudflare-workers-version-overrides'),`xguard-mainnet="${candidate}"`);
  assert.equal(new Headers(calls[1].init.headers).has('cloudflare-workers-version-overrides'),false);
  assert.ok(calls.every(x=>x.init.method==='GET'&&x.init.redirect==='error'&&x.init.body===undefined));
  assert.throws(()=>createAuditGet({candidate:'invalid'}),/candidate Worker ID/);
});
test('a missing candidate revision never passes a deployment audit',async()=>{
  await assert.rejects(auditStability({get:get(endpoints()),expectedTag:'git-b88d3253569c'}),/candidate witness Worker tag/);
});
