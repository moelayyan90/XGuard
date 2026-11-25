import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { dirname,resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare,convertV4MiniflareOptions } from 'miniflare';
import { decodePaymentRequiredHeader } from '@x402/core/http';
import { Client,StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { Message } from '@a2a-js/sdk';
import { ClientFactory,ClientFactoryOptions,DefaultAgentCardResolver,JsonRpcTransportFactory } from '@a2a-js/sdk/client';
import { SERVICES } from '../src/intelligence/catalog.js';
const relay=fileURLToPath(new URL('../',import.meta.url)), bundle=resolve(relay,'../../.live-build/paid-only/paid-only-entry.js');
execFileSync(process.execPath,[resolve(relay,'node_modules/wrangler/bin/wrangler.js'),'deploy','src/paid-only-entry.js','--config','wrangler.live-local.jsonc','--dry-run','--outdir',dirname(bundle)],{cwd:relay,env:{...process.env,WRANGLER_SEND_METRICS:'false'},stdio:'pipe'});
const origin='https://api.xguardgate.com',root=origin+'/api/intelligence/v1';
const payTo='0x8e526ba9b0b348c1b6935176719d7acf0225aabf';
const ns={PAID_GATEWAY:{className:'PaidGatewayState',useSQLite:true},PROOF_AUTHORITY:{className:'ProofAuthority',useSQLite:true}};
let outside=0;
const mf=new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,workers:[{
  name:'paid-only-runtime',modules:true,modulesRoot:dirname(bundle),scriptPath:bundle,compatibilityDate:'2026-08-25',compatibilityFlags:['nodejs_compat'],
  bindings:{XGUARD_PAYMENT_ENVIRONMENT:'production',XGUARD_PAID_FACILITATOR:'https://unreachable.invalid',XGUARD_TREASURY_USDC_ADDRESS:payTo,XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS:'100',XGUARD_PAYMENT_COST_BUDGET_USD_MICROS:'0'},durableObjects:ns,
  outboundService:async()=>{outside++;throw new Error('All external requests disabled during these contract checks');},
}]}));
const fetcher=async(url,init)=>mf.dispatchFetch(url instanceof Request?url.url:String(url),init);
const headers={'content-type':'application/json','x-xguard-traffic-class':'synthetic'};
try {
  await mf.ready;
  const bound=await mf.getWorker('paid-only-runtime');
  assert.equal((await bound.readSettlementFact('all-records')).status,400);
  assert.equal((await fetcher(origin+'/readSettlementFact')).status,404);
  assert.equal((await fetcher('https://xguard-origin.internal/fact/npm/react/latest-version')).status,421);
  const docs={openapi:'3.1.0',paths:{}};
  for(const d of SERVICES) {
    const q=d.route==='breaking-changes'?{before:docs,after:docs}:d.route==='evidence'?{entity:'npm/react',observation:'immutable-record'}:d.example;
    const r=await fetcher(root+'/'+d.route,{method:'POST',headers,body:JSON.stringify(q)});
    assert.equal(r.status,402,d.route+' '+(r.status!==402?await r.text():''));
    const offer=decodePaymentRequiredHeader(r.headers.get('payment-required')); assert.equal(offer.accepts[0].amount,'1000');assert.equal(offer.accepts[0].payTo.toLowerCase(),payTo);
    assert.ok(r.headers.get('x-xguard-quote'));assert.equal(offer.resource.url,root+'/'+d.route);assert.ok(!('result' in offer));
  }
  const first=await fetcher(root+'/batch',{method:'POST',headers,body:JSON.stringify({facts:Array(100).fill('npm/react/latest-version')})});
  assert.equal(first.status,402);assert.equal(decodePaymentRequiredHeader(first.headers.get('payment-required')).accepts[0].amount,'100000');
  const head=await fetcher(origin+'/fact/npm/react/latest-version',{method:'HEAD',headers});
  assert.equal(head.status,402);assert.equal(await head.text(),'');assert.ok(head.headers.get('payment-required'));
  for (const path of ['/live/npm/react','/history/npm/react','/changes/npm/react','/evidence/npm/react/a1']) {
    const response=await fetcher(origin+path,{method:'HEAD',headers});
    assert.equal(response.status,402,path);
    assert.equal(decodePaymentRequiredHeader(response.headers.get('payment-required')).accepts[0].amount,'1000');
    assert.equal(await response.text(),'');
  }
  const catalog=await (await fetcher(root+'/catalog',{headers})).json();
  if(catalog.new_payments_enabled) {
    const invalid=await fetcher(root+'/facts',{method:'POST',headers:{...headers,'idempotency-key':'invalid-payment-check','payment-signature':'bad'},body:JSON.stringify({fact:'npm/react/latest-version'})});
    assert.equal(invalid.status,402);
    assert.equal((await invalid.json()).result,undefined);
  }
  const mcp=new Client({name:'intelligence-sdk-check',version:'1.0.0'},{versionNegotiation:{mode:'auto'}});
  await mcp.connect(new StreamableHTTPClientTransport(new URL(origin+'/mcp'),{fetch:fetcher}));
  try { const list=await mcp.listTools();assert.equal(list.tools.length,SERVICES.length); } finally {await mcp.close();}
  const factory=new ClientFactory(ClientFactoryOptions.createFrom(ClientFactoryOptions.default,{cardResolver:new DefaultAgentCardResolver({fetchImpl:fetcher}),transports:[new JsonRpcTransportFactory({fetchImpl:fetcher})],preferredTransports:['JSONRPC']}));
  const agent=await factory.createFromUrl(origin);
  const message=await agent.sendMessage({message:Message.fromJSON({messageId:crypto.randomUUID(),role:'ROLE_USER',parts:[{data:{action:'xguard.discover'}}]})});
  assert.ok(message);
  assert.equal(outside,0,'Quoting and discovery must never contact payment, data or other third parties.');
  console.log(JSON.stringify({services_challenged:SERVICES.length,batch_units:100,batch_atomic:'100000',mcp_sdk:true,a2a_sdk:true,external_calls:outside}));
} finally {await mf.dispose();}
