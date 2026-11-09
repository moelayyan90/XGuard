import test from 'node:test';
import assert from 'node:assert/strict';
import { capacityPreflight } from './live-capacity-preflight.mjs';
const now=Date.parse('2026-11-09T12:00:00Z');
const fetcher=(status,body,version='old')=>async()=>Response.json(body,{status,headers:{'x-xguard-worker-version-id':version}});
test('confirmed provider exhaustion prevents upload without weakening canary checks',async()=>{
  for(const error of ['storage_write_quota_exhausted','storage_read_quota_exhausted','storage_request_quota_exhausted'])assert.deepEqual(await capacityPreflight({now,previousVersion:'old',fetchImpl:fetcher(503,{error,quota_reset_at:'2026-11-10T00:00:00Z'})}),{blocked:true,reason:error,reset_at:'2026-11-10T00:00:00Z',upload_attempted:false});
});
test('healthy and unrelated unhealthy baselines still require all existing canary checks',async()=>{
  for(const status of [200,503]){const result=await capacityPreflight({now,previousVersion:'old',fetchImpl:fetcher(status,{error:'unrelated'})});assert.equal(result.blocked,false);assert.equal(result.full_canary_checks_required,true);}
});
test('stale quota and changed production revision require diagnosis',async()=>{
  await assert.rejects(capacityPreflight({now,previousVersion:'old',fetchImpl:fetcher(503,{error:'storage_write_quota_exhausted',quota_reset_at:'2026-11-09T00:00:00Z'})}),/fresh diagnosis/);
  await assert.rejects(capacityPreflight({now,previousVersion:'old',fetchImpl:fetcher(200,{},'new')}),/version changed/);
});
