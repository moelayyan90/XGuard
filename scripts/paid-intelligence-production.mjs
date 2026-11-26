import assert from 'node:assert/strict';
import { setTimeout as wait } from 'node:timers/promises';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { SERVICES, BASE } from '../apps/relay/src/intelligence/catalog.js';
import { inspectIntelligenceOffer } from '../sdk/paid-api.js';
import { runGlamaProductionCheck } from './glama-production-check.mjs';

const origins = ['https://xguardgate.com','https://api.xguardgate.com'];
const root = '/api/intelligence/v1';
const audience = origins[1] + '/internal/release-health';
const manifest = JSON.parse(readFileSync(new URL('../server.json',import.meta.url)));
const fact = {fact:'npm/react/latest-version'};
const docs = {openapi:'3.1.0', paths:{}};

async function monitorCredential() {
  const url = new URL(process.env.ACTIONS_ID_TOKEN_REQUEST_URL);
  url.searchParams.set('audience',audience);
  const response = await fetch(url,{headers:{authorization:'Bearer '+process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN},redirect:'error',signal:AbortSignal.timeout(8000)});
  assert.equal(response.status,200,'GitHub release identity unavailable');
  const {value} = await response.json();
  assert.ok(typeof value === 'string' && value.split('.').length === 3,'GitHub returned no release identity');
  return value;
}

export async function checkProduction({candidate,tag,full=false,fetchImpl=fetch,credential=monitorCredential} = {}) {
  const headers = {'cache-control':'no-cache','x-xguard-traffic-class':'synthetic','user-agent':'XGuard-Release-Check/1.0'};
  if (candidate) {
    assert.match(candidate,/^[a-f0-9-]{36}$/);
    headers['cloudflare-workers-version-overrides']='xguard-mainnet="'+candidate+'"';
  }
  const request = (url, init={}) => fetchImpl(url,{...init,headers:{...headers,...init.headers},redirect:'manual',signal:AbortSignal.timeout(12000)});
  async function check(url, status, init) {
    let r = await request(url,init);
    if (r.status === 429 && status !== 429) {
      const limit = await r.json();
      const seconds = Number(limit.details?.retry_after_seconds ?? 60);
      assert.ok(Number.isInteger(seconds) && seconds >= 1 && seconds <= 60, 'Unexpected rate limit window');
      await wait((seconds + 1) * 1000);
      r = await request(url,init);
    }
    assert.equal(r.status,status,url);
    if(tag) assert.equal(r.headers.get('x-xguard-worker-version-tag'),tag,url);
    if(candidate) assert.equal(r.headers.get('x-xguard-worker-version-id'),candidate,url);
    assert.match(r.headers.get('cache-control')||'',/no-store/,url);
    return r;
  }
  const post = (body,extra={}) => ({method:'POST',headers:{'content-type':'application/json',...extra},body:JSON.stringify(body)});
  for(const origin of origins) {
    const catalog=await (await check(origin+root+'/catalog',200)).json();
    assert.equal(catalog.new_payments_enabled,true);
    assert.equal(catalog.price.unit_price,'0.001');
    assert.deepEqual(catalog.services.map(s=>s.id),SERVICES.map(s=>s.route));
    assert.deepEqual(await (await check(origin+'/server.json',200)).json(),manifest);
    for(const service of full ? SERVICES : SERVICES.filter(s=>s.route==='facts')) {
      const input=service.route==='breaking-changes'?{before:docs,after:docs}:service.route==='evidence'?{entity:'npm/react',observation:'release-check'}:service.example;
      const endpoint=origin+root+'/'+service.route;
      const response=await check(endpoint,402,post(input));
      const challenge=JSON.parse(Buffer.from(response.headers.get('payment-required'),'base64'));
      inspectIntelligenceOffer(BASE+'/'+service.route,input,challenge);
      assert.ok(!('result' in await response.json()),service.route);
      if (full) {
        const rejected=await check(endpoint,402,post(input,{'payment-signature':'invalid','idempotency-key':response.headers.get('idempotency-key'),'x-xguard-quote':response.headers.get('x-xguard-quote')}));
        assert.ok(!('result' in await rejected.json()),service.route);
      }
    }
    const batch={facts:Array(100).fill(fact.fact)};
    const bulk=await check(origin+root+'/batch',402,post(batch));
    assert.equal(inspectIntelligenceOffer(BASE+'/batch',batch,JSON.parse(Buffer.from(bulk.headers.get('payment-required'),'base64'))).amount_atomic,'100000');
    for(const format of full ? ['text/html','application/json','text/markdown'] : ['text/html']) {
      const alias=await check(origin+'/fact/'+fact.fact,402,{headers:{accept:format}});
      assert.ok(alias.headers.has('payment-required'));
      assert.equal(await (await check(origin+'/fact/'+fact.fact,402,{method:'HEAD',headers:{accept:format}})).text(),'');
    }
    for(const [path,status] of [['/healthz',401],['/readyz',401],['/admin/paid-revenue',401],[root+'/admin/revenue',401],['/internal/release-health',401],['/changes.atom',503],['/topics',503],['/verify',503],['/settle',503]]) {
      const response=await check(origin+path,status);
      assert.ok((await response.json()).error,path);
    }
    const rpc=(method,params)=>post({jsonrpc:'2.0',id:1,method,params});
    const tools=await (await check(origin+'/mcp',200,rpc('tools/list',{}))).json();
    assert.equal(tools.result.tools.length,SERVICES.length);
    const mcp=await (await check(origin+'/mcp',402,rpc('tools/call',{name:'xguard.facts',arguments:fact}))).json();
    assert.equal(mcp.error.code,-32042);
    const a2a=await (await check(origin+'/a2a',402,rpc('SendMessage',{message:{messageId:'release-check',role:'ROLE_USER',parts:[{data:{action:'xguard.facts',input:fact}}]}}))).json();
    assert.equal(a2a.error.code,-32042);
  }
  const prepaid=origins[0]+'/api/gateway/v1/fact/'+fact.fact;
  const challenge=await check(prepaid,402);
  assert.equal(JSON.parse(Buffer.from(challenge.headers.get('payment-required'),'base64')).accepts[0].amount,'1000');
  const denied=await check(prepaid,402,{headers:{authorization:'Bearer xgk_'+'0'.repeat(64),'idempotency-key':'xguard-release-invalid'}});
  assert.equal((await denied.json()).error,'lemon_license_not_authorized');
  await runGlamaProductionCheck({expectedTag:tag,fetcher:(url,init)=>request(url,init)});
  const token=await credential();
  const health=await check(audience,200,{headers:{authorization:'Bearer '+token}});
  const state=await health.json();
  assert.equal(state.status,'verified');
  assert.deepEqual(Object.keys(state).sort(),['checked_at','status','worker_id']);
  assert.equal(state.worker_id,health.headers.get('x-xguard-worker-version-id'));
  assert.ok(Math.abs(Date.now()-Date.parse(state.checked_at))<75*60000);
  return {version:state.worker_id,services:SERVICES.length,full,hosts:origins.length,batch_amount_atomic:'100000',settlements_submitted:0};
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  console.log(JSON.stringify(await checkProduction({candidate:process.env.CANDIDATE_WORKER_ID,tag:process.env.EXPECTED_XGUARD_TAG,full:process.argv.includes('--full')})));
