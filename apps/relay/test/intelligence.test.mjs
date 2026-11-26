import test from 'node:test';
import assert from 'node:assert/strict';
import { SERVICES, amountFor, fits, routeFor } from '../src/intelligence/catalog.js';
import { compareOpenApi } from '../src/intelligence/openapi.js';
import { prepareIntelligence } from '../src/intelligence/engine.js';
import { intelligenceSurface } from '../src/intelligence/surface.js';
import { gatewayConfig } from '../src/paid-agent-entry.js';
import { environment, seed } from './live-harness.mjs';
const base = 'https://api.xguardgate.com', root = '/api/intelligence/v1';
const get = (path, init,env={}) => intelligenceSurface(new Request(base+path,init),env,{});
const post = (path,body,headers={}) => get(path,{method:'POST',body:JSON.stringify(body),headers:{'content-type':'application/json',...headers}});
const input = (route,query) => ({capability:'intel-'+route,query,idempotency_key:'intelligence-test'});
test('atomic units use integers for all batch sizes; malformed batches never obtain a price',()=>{
  for (let n=1;n<=100;n++) assert.equal(amountFor(input('batch',{facts:Array(n).fill('a')})),String(n*1000));
  assert.throws(()=>amountFor(input('batch',{facts:[]})));
  assert.throws(()=>amountFor(input('batch',{facts:Array(101)})));
  const env = {XGUARD_PAYMENT_ENVIRONMENT:'production',XGUARD_TREASURY_USDC_ADDRESS:'0x1111111111111111111111111111111111111111',XGUARD_PAID_FACILITATOR:'https://facilitator.example',XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS:'100',XGUARD_PAYMENT_COST_BUDGET_USD_MICROS:'0'};
  assert.equal(gatewayConfig(env,false,input('batch',{facts:Array(100)})).amount,'100000');
  assert.equal(gatewayConfig({...env,XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS:'250'},false,input('facts',{})).configured,false);
});
test('registered handlers, discovery and both transports agree',async()=>{
  const c=await (await get(root+'/catalog')).json();
  const s=await (await get(root+'/openapi.json')).json();
  const t=await (await post('/mcp',{jsonrpc:'2.0',id:1,method:'tools/list'})).json();
  const a=await (await get('/.well-known/agent-card.json')).json();
  assert.equal(c.services.length,SERVICES.length);
  assert.equal(Object.keys(s.paths).length,SERVICES.length);
  assert.deepEqual(t.result.tools.map(x=>x.name),a.skills.map(x=>x.id));
  assert.equal(c.price.unit_price,'0.001');
  assert.equal((await get('/',{method:'HEAD'})).body,null);
});
test('strict entry fails closed before legacy routes, streams, finance, caches and private checks',async()=>{
  const fixtures=['/changes.atom','/topics','/live/npm/react','/witness/add-checkpoint','/verify','/settle','/v1/checkout/orders','/api/paid/v1/extract','/v1/new-service','/healthz','/api/paid/v1/readiness','/admin/paid-revenue','/future-handler','/mcp'];
  for(const path of fixtures) for(const method of ['GET','HEAD','POST']) {
    let calls=0;
    const r=await intelligenceSurface(new Request(base+path,{method,headers:{authorization:'Bearer ordinary-api-key'}}),{}, {},async()=>{calls++;return new Response('private-data')});
    assert.equal(calls,0,path); assert.ok(r.status>=400,path); assert.equal(r.headers.get('cache-control'),'private, no-store'); assert.doesNotMatch(await r.text(),/private-data/);
  }
  assert.equal((await intelligenceSurface(new Request('https://unregistered.example'+root+'/catalog'),{},{})).status,421);
});
test('missing financial bindings and unavailable data never yield a paid service result',async()=>{
  const ab=await get('/fact/npm/react/latest-version');assert.equal(ab.status,503);assert.equal((await ab.json()).result,undefined);
  const r=await post(root+'/facts',{fact:'npm/react/latest-version',max_amount_atomic:'999'});assert.equal(r.status,400);
  assert.equal((await post(root+'/batch',{facts:Array(101).fill('x')})).status,400);
  assert.equal((await post('/a2a',{jsonrpc:'2.0',id:1,method:'SendMessage',params:{message:{messageId:'req',role:'ROLE_USER',parts:[{data:{action:'xguard.fact.get',factId:'npm/react/latest-version'}}]}}})).status,503);
});
test('facts, history, model status and all-or-nothing batch preserve observed evidence',async()=>{
  const h=environment();try{
    await seed(h); const f=await prepareIntelligence(input('facts',{fact:'npm/react/latest-version'}),h.env);
    assert.equal(f.data.source,'https://registry.npmjs.org/react/latest'); assert.equal(f.data.value,'1.0.0');assert.ok(f.data.age_seconds>=0);
    const batch=await prepareIntelligence(input('batch',{facts:Array(100).fill(f.data.id)}),h.env); assert.equal(batch.data.units,100);
    assert.equal((await prepareIntelligence(input('history',{fact:f.data.id}),h.env)).data.observations.length,1);
    await assert.rejects(prepareIntelligence(input('batch',{facts:[f.data.id,'npm/react/unavailable']}),h.env));
    await assert.rejects(prepareIntelligence(input('models',{fact:f.data.id}),h.env));
    await assert.rejects(prepareIntelligence(input('infrastructure',{provider:'github'}),h.env));
  }finally{h.close()}
});
test('OpenAPI comparison identifies consumer breaks and reports unresolved coverage',()=>{
  const p={openapi:'3.1.0',paths:{'/x':{get:{responses:{200:{content:{'application/json':{schema:{$ref:'#/components/schemas/R'}}}}}}},'/gone':{get:{}}},components:{schemas:{R:{type:'object',properties:{qty:{type:'integer'},name:{type:'string'}}}}}};
  const q=structuredClone(p); delete q.paths['/gone'];q.paths['/x'].get.parameters=[{name:'auth',in:'header',required:true,schema:{type:'string'}}];q.components.schemas.R.properties.qty.type='string';delete q.components.schemas.R.properties.name;
  const v=compareOpenApi(p,q);assert.equal(v.verdict,'breaking_changes_found');for(const k of ['schema_type_changed','field_removed','path_removed','parameter_now_required']) assert.ok(v.findings.some(x=>x.change===k));
  q.components.schemas.R.properties.qty={$ref:'https://example.org/schema'};assert.ok(compareOpenApi(p,q).coverage_limits.length);
});
test('OSV partial responses cannot certify safety and npm semver respects prereleases',async()=>{
  const fn=async url=>Response.json(String(url).includes('osv.dev')?{next_page_token:'next'}:{name:'test-lib',version:'1.0.0',engines:{node:'>=20 <23'}});
  const sec=await prepareIntelligence(input('decisions',{question:'known-vulnerabilities',ecosystem:'Go',name:'example.org/a',version:'1.0.0'}),{},fn);
  assert.equal(sec.data.decision,'incomplete');
  const comp=await prepareIntelligence(input('compatibility',{name:'test-lib',version:'1.0.0',target:'node',target_version:'22.0.0'}),{},fn);assert.equal(comp.data.verdict,'matches_declared_range');
  const pre=await prepareIntelligence(input('compatibility',{name:'test-lib',version:'1.0.0',target:'node',target_version:'22.0.0-beta.1'}),{},fn);assert.equal(pre.data.verdict,'outside_declared_range');
  assert.equal(fits(routeFor('tools').schema,{task:'arbitrary',url:'https://example.net'}),false);
});

import { acceptsExactAuthorization, selectFacilitator } from '../src/core/payment-health.js';
test('new payments select an advertised compatible rail during a primary outage', async () => {
  const config = { facilitator: 'https://facilitator.xpay.sh', network: 'eip155:8453', amount: '1000', asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' };
  const fallback = 'https://facilitator.payai.network';
  const env = { X402_GLOBAL_PRIMARY: fallback, PAID_GATEWAY: {
    idFromName: name => name, get: () => ({ fetch: async () => Response.json({ facilitators: [] }) }),
  } };
  const calls = [];
  const kind = { x402Version: 2, scheme: 'exact', network: config.network };
  const fetchImpl = async (url, init) => {
    calls.push(url);
    assert.deepEqual(Object.keys(init.headers), ['accept']);
    assert.equal(init.redirect, 'manual');
    assert.equal(url.endsWith('/supported'), true);
    return url.startsWith(fallback + '/') ? Response.json({ kinds: [kind] }) : new Response(null, { status: 503 });
  };
  assert.equal(await selectFacilitator(env, config, { fetchImpl }), fallback);
  assert.equal(await selectFacilitator(env, config, { fetchImpl, requireAdvertisement: true }), fallback);
  assert.deepEqual(calls, [config.facilitator + '/supported', fallback + '/supported']);
  for (const extra of [{ assetTransferMethod: 'permit2' }, { asset: '0x00' }, { minPaymentAmountAtomic: '1001' }]) {
    assert.equal(acceptsExactAuthorization({ ...kind, extra }, config), false);
  }
  assert.equal(acceptsExactAuthorization({ ...kind, extra: { asset: config.asset, assetTransferMethod: 'eip3009', minPaymentAmountAtomic: '1000' } }, config), true);
  await assert.rejects(selectFacilitator({ ...env }, { ...config, testnet: true, network: 'eip155:84532' }, { fetchImpl, requireAdvertisement: true }));
});

test('one historical comparison and one bounded history query use the requested timestamps', async () => {
  const h=environment();
  try {
    await seed(h,'1.0.0','2026-10-01T00:00:00.000Z');
    await seed(h,'2.0.0','2026-10-05T00:00:00.000Z');
    const query={fact:'npm/react/latest-version',from:'2026-10-02T00:00:00Z',to:'2026-10-06T00:00:00Z'};
    const comparison=await prepareIntelligence(input('compare',query),h.env);
    assert.equal(comparison.data.before.value,'1.0.0');
    assert.equal(comparison.data.after.value,'2.0.0');
    const history=await prepareIntelligence(input('history',{...query,limit:5}),h.env);
    assert.deepEqual(history.data.observations.map(row=>row.value),['2.0.0']);
    await assert.rejects(prepareIntelligence(input('compare',{...query,to:'2025-10-06T00:00:00Z'}),h.env));
  } finally { h.close(); }
});
test('dependency evidence distinguishes a yanked PyPI release and a linked archived repository', async () => {
  const get=async url=>{
    if (url==='https://api.osv.dev/v1/query') return Response.json({});
    if (url==='https://pypi.org/pypi/xguard-fixture/2.0.1/json') return Response.json({info:{name:'XGuard_fixture',version:'2.0.1',requires_python:'>=3.10',project_urls:{Source:'https://github.com/example/fixture'}},urls:[{yanked:true}]});
    if (url==='https://api.github.com/repos/example/fixture') return Response.json({full_name:'example/fixture',archived:true});
    throw Error('unexpected source');
  };
  const result=await prepareIntelligence(input('dependencies',{ecosystem:'PyPI',name:'XGuard_fixture',version:'2.0.1'}),{},get);
  assert.equal(result.data.publisher.exact.yanked,true);
  assert.equal(result.data.publisher.exact.requires_python,'>=3.10');
  assert.equal(result.data.maintenance,'publisher_linked_repository_archived');
  assert.equal(result.data.advisory.verdict,'no_matching_advisory_reported');
});

test('the retained witness agreement uses only the pinned production log and published monitor', async () => {
  const { originHashHex, PINNED_LOGS } = await import('../src/c2sp-witness.js');
  const origin = 'gblin.digital/receipts-log';
  const hash = await originHashHex(origin);
  assert.deepEqual(Object.keys(PINNED_LOGS), [origin]);
  const forwarded = [];
  const env = { C2SP_WITNESS: {
    idFromName: name => { assert.equal(name, 'xguard-c2sp-witness-v1'); return name; },
    get: () => ({ fetch: async request => {
      forwarded.push([new URL(request.url).pathname, request.method]);
      return new Response('existing C2SP route');
    } }),
  } };
  for (const path of ['/witness','/witness/metadata','/witness/verifier-key','/witness/'+hash+'/status','/witness/'+hash+'/checkpoint']) {
    assert.equal((await get(path, {method:'HEAD'}, env)).status, 200, path);
  }
  const post = await get('/witness/add-checkpoint',{method:'POST',body:'checkpoint'},env);
  assert.equal(post.status, 200);
  assert.equal((await get('/witness/'+'0'.repeat(64)+'/checkpoint',{},env)).status, 503);
  assert.equal((await get('/witness/add-checkpoint',{method:'GET'},env)).status, 503);
  assert.equal(forwarded.length, 6);
  assert.equal((await get('/v1/checkout/orders/xgo_'+'0'.repeat(40))).status,401);
  assert.equal((await get('/v1/compute/receipts/xcq_'+'0'.repeat(32))).status,404);
  assert.equal((await get('/v1/tasks/xgtask_'+'0'.repeat(32))).status,404);
});

test('release health accepts a signed identity only for the two production workflows', async () => {
  const { SignJWT, generateKeyPair } = await import('jose');
  const { workflowMonitor, monitorAudience } = await import('../src/intelligence/release-health.js');
  const {privateKey,publicKey}=await generateKeyPair('RS256');
  const repository='moelayyan90/XGuard';
  const claims={repository,repository_id:'1334264385',repository_owner_id:'306228198',ref:'refs/heads/main',
    workflow_ref:repository+'/.github/workflows/deploy.yml@refs/heads/main',event_name:'workflow_run'};
  async function make(overrides={},audience=monitorAudience) {
    return new SignJWT({...claims,...overrides}).setProtectedHeader({alg:'RS256'}).setIssuedAt().setExpirationTime('5m')
      .setIssuer('https://token.actions.githubusercontent.com').setSubject('release').setAudience(audience).sign(privateKey);
  }
  assert.equal(await workflowMonitor(await make(), publicKey),true);
  assert.equal(await workflowMonitor(await make({event_name:'schedule',workflow_ref:repository+'/.github/workflows/live-monitor.yml@refs/heads/main'}),publicKey),true);
  for(const claims of [{event_name:'pull_request'},{ref:'refs/heads/feature'},{repository_owner_id:'0'},{repository_id:'0'},{workflow_ref:repository+'/.github/workflows/ci.yml@refs/heads/main'}])
    assert.equal(await workflowMonitor(await make(claims),publicKey),false);
  assert.equal(await workflowMonitor(await make({},'other-audience'),publicKey),false);
  assert.equal(await workflowMonitor('missing.signature',publicKey),false);
});

test('a stale observation cannot authorize a current single or batch result; dated history remains available',async()=>{
  const h=environment();
  const fact='npm/react/latest-version';
  try {
    await seed(h,'1.0.0','2025-01-01T00:00:00Z');
    await assert.rejects(prepareIntelligence(input('facts',{fact}),h.env),/current_fact_unavailable/);
    await assert.rejects(prepareIntelligence(input('batch',{facts:[fact,fact]}),h.env),/current_fact_unavailable/);
    const history=await prepareIntelligence(input('history',{fact}),h.env);
    assert.equal(history.data.observations[0].value,'1.0.0');
  } finally { h.close(); }
});
