import assert from 'node:assert/strict';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData, encodeEventTopics, encodeAbiParameters, parseAbiItem, sha256 } from 'viem';
import { createIdentity, signCommand } from '../../../sdk/financial-authority/client.mjs';
import { verifyReceiptOffline } from '../../../sdk/financial-authority/verify-receipt.mjs';
import { verifyLiveDelivery } from '../../../sdk/live-paid.js';
import { bytes, b64 } from '../src/financial-authority/crypto.js';

const source = fileURLToPath(new URL('../src/authority.js', import.meta.url));
const paid = fileURLToPath(new URL('../src/paid-agent-entry.js', import.meta.url));
const http = fileURLToPath(new URL('../src/financial-authority/http.js', import.meta.url));
const paidHttp = fileURLToPath(new URL('../src/live-paid-entry.js', import.meta.url));
const bundle = await build({ stdin: { resolveDir: dirname(source), contents: `
  import { AgentAuthority } from ${JSON.stringify(source)};
  import { PaidGatewayState } from ${JSON.stringify(paid)};
  export { ProofAuthority } from ${JSON.stringify(paid)};
  import { financialAuthorityFetch } from ${JSON.stringify(http)};
  import { livePaidFetch } from ${JSON.stringify(paidHttp)};
  export class TestAuthority extends AgentAuthority {
    async fetch(request) {
      const p = new URL(request.url).pathname;
      if (p === '/fixture/fail-invoice') { this.state.storage.sql.exec("CREATE TRIGGER fee_fault BEFORE UPDATE ON afa_records WHEN NEW.key LIKE 'op:%' AND json_extract(NEW.value,'$.service_fee.invoice.state') = 'COLLECTED' BEGIN SELECT RAISE(ABORT,'fixture_invoice_storage_failure'); END"); return new Response('ok'); }
      if (p === '/fixture/restore-invoice') { this.state.storage.sql.exec('DROP TRIGGER IF EXISTS fee_fault'); return new Response('ok'); }
      const response = await super.fetch(request), body = await response.clone().json();
      if (response.ok && body.measured_resources) await this.env.AFA_TEST_METER.fetch('https://fixture/meter',{method:'POST',body:JSON.stringify({path:p,...body.measured_resources})});
      return response;
    }
  }
  export class TestGateway extends PaidGatewayState {
    async fetch(request) { if (new URL(request.url).pathname === '/fixture/reconcile') { await this.alarm(); return new Response('ok'); } return super.fetch(request); }
  }
  export default { async fetch(request, env, ctx) {
    if (new URL(request.url).pathname.startsWith('/api/paid/v1')) return livePaidFetch(request,env,ctx);
    return await financialAuthorityFetch(request,env) || new Response('not found',{status:404});
  }};
` }, bundle: true, format: 'esm', platform: 'browser', write: false,
  plugins: [{ name: 'node-url', setup(b) { b.onResolve({ filter: /^(?:node:)?url$/ }, () => ({ path: 'node:url', external: true })); } }] });

const persist = await mkdtemp(join(tmpdir(), 'xguard-authority-commerce-'));
const payee = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07', merchant = '0x1111111111111111111111111111111111111111';
const asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', blockHash = '0x' + 'b'.repeat(64);
const owner = await createIdentity(), parent = await createIdentity(), agent = await createIdentity(), executor = await createIdentity();
const tokens = new Map(), txs = new Map();
let mf, feeMode = 'ok', principalMode = 'ok', reorg = false, shallow = false, settles = 0, verifies = 0, principalExecutions = 0;
const metering = []; let commerceMeterStart = 0, measuredCommerceResources;
const types = { TransferWithAuthorization: ['from:address','to:address','value:uint256','validAfter:uint256','validBefore:uint256','nonce:bytes32'].map(x => { const [name,type] = x.split(':'); return { name,type }; }) };
const events = [parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'), parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')];
function transactionFor(auth, label) { const hash = sha256(bytes(label + ':' + auth.nonce)); txs.set(hash, auth); return hash; }
function logsFor(hash, auth, omitTransfer = false) {
  const common = { address: asset, blockHash, blockNumber:'0x1000', transactionHash:hash, transactionIndex:'0x0', removed:false };
  const logs = [{ ...common, logIndex:'0x0', data:'0x', topics:encodeEventTopics({abi:events,eventName:'AuthorizationUsed',args:{authorizer:auth.from,nonce:auth.nonce}}) }];
  if (!omitTransfer) logs.push({ ...common,logIndex:'0x1',data:encodeAbiParameters([{type:'uint256'}],[BigInt(auth.value)]),topics:encodeEventTopics({abi:events,eventName:'Transfer',args:{from:auth.from,to:auth.to}}) });
  return logs;
}
async function outbound(request) {
  const u = new URL(request.url);
  if (u.hostname === 'facilitator.test') {
    if (u.pathname === '/supported') return MFResponse.json({ kinds:[{x402Version:2,scheme:'exact',network:'eip155:8453'}] });
    const {paymentPayload,paymentRequirements} = await request.json(), a = paymentPayload.payload.authorization;
    if (u.pathname === '/verify') {
      verifies++;
      const valid = await verifyTypedData({address:a.from,types,primaryType:'TransferWithAuthorization',domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:paymentRequirements.asset},message:{...a,value:BigInt(a.value),validAfter:BigInt(a.validAfter),validBefore:BigInt(a.validBefore)},signature:paymentPayload.payload.signature}).catch(()=>false);
      return MFResponse.json({isValid:valid,payer:a.from,...(valid?{}:{invalidReason:'invalid_signature'})});
    }
    assert.equal(u.pathname,'/settle'); settles++;
    if (feeMode === 'rejected') return MFResponse.json({success:false,errorReason:'invalid_payment',payer:a.from,transaction:'',network:'eip155:8453'},{status:400});
    const hash = transactionFor(a,'service-fee');
    if (feeMode === 'lost') return new MFResponse('response lost after execution',{status:503});
    return MFResponse.json({success:true,network:'eip155:8453',transaction:hash,payer:a.from});
  }
  if (u.hostname === 'chain.test') {
    const { id,method,params } = await request.json(); let result;
    if (method === 'eth_chainId') result = '0x2105';
    else if (method === 'eth_blockNumber') result = shallow ? '0x1000' : '0x1002';
    else if (method === 'eth_getBlockByNumber') result = { hash:reorg?'0x'+'c'.repeat(64):blockHash,number:'0x1000',parentHash:'0x'+'0'.repeat(64),nonce:'0x0000000000000000',sha3Uncles:'0x'+'0'.repeat(64),logsBloom:'0x'+'0'.repeat(512),transactionsRoot:'0x'+'0'.repeat(64),stateRoot:'0x'+'0'.repeat(64),receiptsRoot:'0x'+'0'.repeat(64),miner:merchant,difficulty:'0x0',totalDifficulty:'0x0',extraData:'0x',size:'0x100',gasLimit:'0xffffff',gasUsed:'0x5208',timestamp:'0x1',transactions:[],uncles:[],baseFeePerGas:'0x1' };
    else if (method === 'eth_getLogs') {
      result = [...txs].flatMap(([hash,a])=>logsFor(hash,a).filter(log=>log.logIndex==='0x0'));
      const topics=params[0].topics || []; result=result.filter(log=>topics.every((topic,i)=>!topic || String(log.topics[i]).toLowerCase()===String(topic).toLowerCase()));
    } else if (method === 'eth_getTransactionReceipt') {
      const hash=params[0], a=txs.get(hash);
      result=a?{transactionHash:hash,transactionIndex:'0x0',blockHash,blockNumber:'0x1000',from:a.from,to:asset,cumulativeGasUsed:'0x5208',gasUsed:'0x5208',effectiveGasPrice:'0x1',logs:logsFor(hash,a,principalMode==='missing_transfer'&&a.to===merchant),logsBloom:'0x'+'0'.repeat(512),status:'0x1',type:'0x2'}:null;
    } else throw Error('Unexpected read-only RPC: '+method);
    return MFResponse.json({jsonrpc:'2.0',id,result});
  }
  throw Error('No real provider or network is permitted in this fixture: '+u.hostname);
}
async function execute(request) {
  const {operation:op} = await request.json();
  if (new URL(request.url).pathname==='/execute') principalExecutions++;
  const transaction = op.payment_context ? transactionFor({from:op.payment_context.payer,to:op.payee,value:op.principal_atomic,nonce:op.payment_context.nonce},'principal') : sha256(bytes('attested:'+op.operation_id));
  const payload = {protocol:'xguard-afa-settlement/1',mode:op.mode,organization_id:op.organization_id,operation_id:op.operation_id,intent_digest:op.intent_digest,payee:op.payee,currency:op.currency,asset:op.asset,network:op.network,principal_atomic:op.principal_atomic,provider_fee_atomic:'0',observed_at:Date.now(),status:principalMode==='failed'?'failed_no_effect':'confirmed',transaction};
  return Response.json({payload,signature:b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},executor.privateKey,bytes(payload)))});
}
function create(deployed=false) {
  return new Miniflare(convertV4MiniflareOptions({host:'127.0.0.1',port:0,resourcePersistencePath:persist,workers:[{
    name:'authority-commerce',modules:true,script:bundle.outputFiles[0].text,compatibilityDate:'2026-08-25',compatibilityFlags:['nodejs_compat'],
    bindings:{...(deployed?{CF_VERSION_METADATA:{id:'fixture-production'}}:{}),LIVE_ADMIN_KEY:'only-local-fixture-owner-access-key',AFA_EXECUTOR_ADAPTER:'fixture',AFA_EXECUTOR_PUBLIC_JWK:JSON.stringify(executor.publicKey),AFA_FEE_SIMULATION:'on',LIVE_PAID_SERVICES:'on',XGUARD_PAYMENT_ENVIRONMENT:'production',XGUARD_PAID_FACILITATOR:'https://facilitator.test',XGUARD_TREASURY_USDC_ADDRESS:payee,XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS:'100',XGUARD_PAYMENT_COST_BUDGET_USD_MICROS:'0',XGUARD_MIN_CONTRIBUTION_BPS:'2000',BASE_RPC_URL:'https://chain.test'},
    durableObjects:{AUTHORITY:{className:'TestAuthority',useSQLite:true},PROOF_AUTHORITY:{className:'ProofAuthority',useSQLite:true},PAID_GATEWAY:{className:'TestGateway',useSQLite:true}},serviceBindings:{AFA_EXECUTOR:execute,AFA_TEST_METER:async request=>{metering.push(await request.json());return new Response('ok');}},outboundService:outbound,
  }]}));
}
const org='commerce_organization', parentGrant='commerce_parent_grant', leafGrant='commerce_leaf_grant';
const feeLimit = (period='2000000')=>({per_operation:'50000',per_period:period,lifetime:'5000000',period_seconds:86400});
const policy=(fees=feeLimit())=>({currency:'USDC',network:'eip155:8453',asset,payees:[merchant],per_operation:'1000000',per_period:'10000000',lifetime:'100000000',period_seconds:86400,service_fee_limit:fees});
const send = async (who,action,payload,organization=org,options={}) => {
  const envelope=await signCommand(who,organization,action,payload,options);
  const r=await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/'+action,{method:'POST',headers:{'content-type':'application/json',...(action==='enroll'?{authorization:'Bearer only-local-fixture-owner-access-key'}:{'x-xguard-organization-token':tokens.get(organization)||''})},body:JSON.stringify(envelope)});
  const body=await r.json(); if(body.result?.organization_token)tokens.set(organization,body.result.organization_token);
  return {status:r.status,...body};
};
const input=(id,grant=leafGrant)=>({operation_id:id,grant_id:grant,currency:'USDC',asset,network:'eip155:8453',payee:merchant,principal_atomic:'1000',provider_fee_cap_atomic:'0',max_service_fee_atomic:'50000',adapter:'fixture',task_digest:'A'.repeat(43),expires_at:Date.now()+120000});
const grant=(id,key,parentId=null,fees=feeLimit(),depth=2)=>({grant_id:id,parent:parentId,agent_key:key,policy:policy(fees),not_before:Date.now()-10000,expires_at:Date.now()+3600000,depth_remaining:depth});
async function complete(id,extra={}) {
  assert.equal((await send(agent,'authorize',{...input(id),...extra})).status,200);
  const r=await send(agent,'execute',{operation_id:id}); assert.equal(r.status,200,JSON.stringify(r)); return r;
}
const payer=()=>new x402Client().register('eip155:8453',new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
async function prepare(id,who=payer()) {
  const checkout=await send(agent,'checkout',{operation_id:id}); assert.equal(checkout.status,200,JSON.stringify(checkout));
  const details=checkout.result.checkout, headers={'content-type':'application/json','idempotency-key':details.idempotency_key}, body=JSON.stringify(details.request);
  const response=await mf.dispatchFetch(details.endpoint,{method:'POST',headers,body});
  assert.equal(response.status,402,await response.clone().text()); const offer=await response.json();
  assert.equal(offer.accepts[0].amount,'50000'); assert.equal(offer.accepts[0].payTo.toLowerCase(),payee);
  const payload=await who.createPaymentPayload(offer);
  return {endpoint:details.endpoint,body,quote:response.headers.get('x-xguard-quote'),payment_identifier:offer.extensions.xguard.paymentIdentifier,headers:{...headers,'x-xguard-quote':response.headers.get('x-xguard-quote'),'payment-signature':encodePaymentSignatureHeader(payload)},payload};
}
const pay=p=>mf.dispatchFetch(p.endpoint,{method:'POST',headers:p.headers,body:p.body});
async function gatewayRecord(p) {
  const ns=await mf.getDurableObjectNamespace('PAID_GATEWAY');
  const index=ns.get(ns.idFromName('xguard-paid-gateway-index-v1'));
  const lookup=await (await index.fetch('https://index/index/lookup',{method:'POST',body:JSON.stringify({payment_identifier:p.payment_identifier})})).json();
  const stub=ns.get(ns.idFromName('payment:'+lookup.record.authorization_fingerprint));
  return {stub,record:(await (await stub.fetch('https://gateway/operation/get',{method:'POST',body:'{}'})).json()).record};
}
const tests=[];async function test(name,fn){await fn();tests.push(name);console.log('PASS '+name);}
let proofKey;
try {
  mf=create();await mf.ready;
  assert.equal((await send(owner,'enroll',{owner_key:owner.publicKey,policies:[policy()],service_fee_budget:feeLimit(),accept_price_atomic:'50000'})).status,200);
  const pg=grant(parentGrant,parent.publicKey);assert.equal((await send(owner,'grant',pg)).status,200);
  const cg=grant(leafGrant,agent.publicKey,parentGrant,feeLimit(),1);cg.expires_at=pg.expires_at;cg.not_before=pg.not_before;assert.equal((await send(parent,'grant',cg)).status,200);
  proofKey=await(await mf.dispatchFetch('https://api.xguardgate.com/v1/authority/proof-key')).json();
  await test('no invoice exists before a completed signed decision',async()=>{
    assert.equal((await send(agent,'authorize',input('uncompleted_invoice'))).status,200);
    assert.equal((await send(agent,'checkout',{operation_id:'uncompleted_invoice'})).status,409);
    assert.equal((await send(owner,'cancel',{operation_id:'uncompleted_invoice'})).status,200);
    assert.equal(settles,0);
  });
  await test('organization service-fee limit is shared across principal currencies',async()=>{
    const otherOrg='fee_budget_organization', a=await createIdentity(), b=await createIdentity(), f=feeLimit('100000');
    const first=policy(f), second={...policy(f),currency:'EUR',asset:'fixture_eur',network:'fiat:fixture',payees:['merchant_eur']};
    assert.equal((await send(owner,'enroll',{owner_key:owner.publicKey,policies:[first,second],service_fee_budget:f,accept_price_atomic:'50000'},otherOrg)).status,200);
    const ga=grant('shared_fee_grant_a',a.publicKey,null,f), gb=grant('shared_fee_grant_b',b.publicKey,null,f);gb.policy=second;
    assert.equal((await send(owner,'grant',ga,otherOrg)).status,200);assert.equal((await send(owner,'grant',gb,otherOrg)).status,200);
    const one=input('shared_fee_operation_a',ga.grant_id), two={...input('shared_fee_operation_b',gb.grant_id),currency:'EUR',asset:'fixture_eur',network:'fiat:fixture',payee:'merchant_eur'};
    assert.equal((await send(a,'authorize',one,otherOrg)).status,200);assert.equal((await send(b,'authorize',two,otherOrg)).status,200);
    assert.equal((await send(a,'authorize',{...one,operation_id:'shared_fee_operation_c'},otherOrg)).status,403);
    assert.equal((await send(owner,'cancel',{operation_id:two.operation_id},otherOrg)).status,200);
    assert.equal((await send(a,'authorize',{...one,operation_id:'shared_fee_operation_c'},otherOrg)).status,200);
  });
  await test('service fee cannot be widened by a subagent',async()=>{
    const evil=await createIdentity(), g=grant('escalated_fee_grant',evil.publicKey,leafGrant,feeLimit('2000001'),0);g.expires_at=cg.expires_at;g.not_before=cg.not_before;
    assert.equal((await send(agent,'grant',g)).status,403);
  });
  await test('one invoice follows signed delivery and preserves merchant payee',async()=>{
    commerceMeterStart = metering.length;
    const r=await complete('completed_invoice');assert.equal(r.result.service_fee.invoice.state,'DUE');assert.equal(r.result.payee,merchant);assert.equal(r.result.service_fee.invoice.payee,payee);
    assert.equal(verifyReceiptOffline(r.receipt.jws,proofKey.jwk).valid,true);
    const again=await send(agent,'status',{operation_id:'completed_invoice'});assert.equal(again.result.service_fee.invoice.id,r.result.service_fee.invoice.id);
  });
  let paidRequest, delivered;
  await test('official x402 payment buys one invoice with independent chain evidence',async()=>{
    paidRequest=await prepare('completed_invoice');const n=settles,r=await pay(paidRequest);assert.equal(r.status,200,await r.clone().text());delivered=await r.json();assert.equal(settles-n,1);
    assert.equal(delivered.result.invoice.state,'COLLECTED');assert.equal(delivered.result.merchant_principal_is_separate,true);
    assert.equal(await verifyLiveDelivery(delivered,proofKey.jwk),true);assert.equal(delivered.accounting.gross_revenue_usd_micros,0);
    const counters=metering.slice(commerceMeterStart);
    measuredCommerceResources={...counters.reduce((a,r)=>({sql_rows_read:a.sql_rows_read+r.sql_rows_read,sql_rows_written:a.sql_rows_written+r.sql_rows_written}),{sql_rows_read:0,sql_rows_written:0}),authority_do_calls:counters.length,scope:'Observed SQLite cursor counters across a warmed two-level principal authorization, signed delivery, status, checkout, x402 offer and one successful simulated fee collection. Includes invoice preflight/claim/completion. Excludes PaidGateway KV/SQL, ProofRail, schema creation, Worker/DO duration, network/gas, retained bytes, invoices, support and tax. One closed-fixture sample, not a production unit-cost invoice.'};
  });
  await test('same payment returns its signed result without repeat debit',async()=>{
    const n=settles,r=await pay(paidRequest);assert.equal(r.status,200,await r.clone().text());assert.equal(settles,n);
    assert.equal((await r.json()).payment_identifier,delivered.payment_identifier);
  });
  await test('a second wallet cannot pay the same invoice again',async()=>{
    const next=await prepare('completed_invoice'),n=settles,r=await pay(next);assert.equal(r.status,409,await r.clone().text());assert.equal(settles,n);
  });
  await test('two racing wallets yield exactly one fee settlement',async()=>{
    await complete('concurrent_invoice');const pair=await Promise.all([prepare('concurrent_invoice'),prepare('concurrent_invoice')]),n=settles;
    const results=await Promise.all(pair.map(pay));assert.equal(results.filter(r=>r.status===200).length,1);assert.equal(results.filter(r=>r.status===409).length,1);assert.equal(settles-n,1);
  });
  await test('forged invoice capabilities cannot reach payment execution',async()=>{
    const raw=JSON.parse(paidRequest.body);raw.invoice_token='A'.repeat(43);const n=verifies;
    const r=await mf.dispatchFetch(paidRequest.endpoint,{method:'POST',headers:{'content-type':'application/json','idempotency-key':'forged-invoice-capability'},body:JSON.stringify(raw)});assert.equal(r.status,401,await r.clone().text());assert.equal(verifies,n);
  });
  await test('lost settlement response never permits a new debit',async()=>{
    await complete('lost_invoice_response');const p=await prepare('lost_invoice_response');feeMode='lost';const n=settles,r=await pay(p);assert.equal(r.status,503,await r.clone().text());assert.equal(settles-n,1);feeMode='ok';
    const other=await prepare('lost_invoice_response'), blocked=await pay(other);assert.equal(blocked.status,409);assert.equal(settles-n,1);
    const {stub}=await gatewayRecord(p);await stub.fetch('https://gateway/fixture/reconcile');
    const recovered=await pay(p);assert.equal(recovered.status,200,await recovered.clone().text());assert.equal(settles-n,1);
  });
  await test('definite no-effect failure permits one explicitly signed replacement',async()=>{
    await complete('rejected_invoice');const p=await prepare('rejected_invoice');feeMode='rejected';const n=settles,r=await pay(p);assert.equal(r.status,402,await r.clone().text());feeMode='ok';
    const replacement=await prepare('rejected_invoice');const success=await pay(replacement);assert.equal(success.status,200,await success.clone().text());assert.equal(settles-n,2);
  });
  await test('storage failure after fee settlement is recovered with original execution credit',async()=>{
    await complete('storage_failure_invoice');const p=await prepare('storage_failure_invoice'),ns=await mf.getDurableObjectNamespace('AUTHORITY'),stub=ns.get(ns.idFromName('afa-v1:sandbox:'+org));
    await stub.fetch('https://authority/fixture/fail-invoice');const n=settles,r=await pay(p);assert.equal(r.status,502,await r.clone().text());const failed=await r.json();await stub.fetch('https://authority/fixture/restore-invoice');
    const credit=failed.error.details.execution_credit;assert.ok(credit);
    const retry=await mf.dispatchFetch(p.endpoint,{method:'POST',headers:{...p.headers,'x-xguard-credit':credit},body:p.body});assert.equal(retry.status,200,await retry.clone().text());assert.equal(settles-n,1);
  });
  await test('independent merchant verification rejects missing transfer and recovers read-only',async()=>{
    const payerAddress=privateKeyToAccount(generatePrivateKey()).address;
    principalMode='missing_transfer';const r=await complete('verified_merchant_invoice',{payment_context:{payer:payerAddress,nonce:'0x'+'9'.repeat(64)}});assert.equal(r.result.state,'UNKNOWN');
    assert.equal((await send(agent,'checkout',{operation_id:'verified_merchant_invoice'})).status,409);
    const n=principalExecutions;principalMode='ok';const recovered=await send(agent,'reconcile',{operation_id:'verified_merchant_invoice'});assert.equal(recovered.result.state,'CONFIRMED');assert.equal(recovered.result.settlement.independently_verified,true);assert.equal(principalExecutions,n);
  });
  await test('repeated dependency failures open the shared circuit before another fee attempt',async()=>{
    const ns=await mf.getDurableObjectNamespace('PAID_GATEWAY'),index=ns.get(ns.idFromName('xguard-paid-gateway-index-v1'));
    for(let i=0;i<3;i++)await index.fetch('https://gateway/live/health',{method:'POST',body:JSON.stringify({failed:true})});
    const n=settles,r=await pay(paidRequest);assert.equal(r.status,503);assert.equal((await r.json()).error,'paid_circuit_open');assert.equal(settles,n);
    // Isolate subsequent fault scenarios using the existing private operator
    // reset. This does not alter production cooldown or expose a reset route.
    await index.fetch('https://gateway/live/circuit-reset',{method:'POST',body:'{}'});
  });
  await test('noncanonical or shallow fee receipts stay unresolved without a second settlement',async()=>{
    await complete('finality_invoice');const p=await prepare('finality_invoice'),n=settles;reorg=true;
    const r=await pay(p);assert.equal(r.status,503,await r.clone().text());reorg=false;shallow=true;
    const {stub}=await gatewayRecord(p);await stub.fetch('https://gateway/fixture/reconcile');assert.notEqual((await gatewayRecord(p)).record.status,'succeeded');shallow=false;
    await stub.fetch('https://gateway/fixture/reconcile');const recovered=await pay(p);assert.equal(recovered.status,200,await recovered.clone().text());assert.equal(settles-n,1);
  });
  await test('restart preserves invoice fencing and simulated accounting',async()=>{
    await mf.dispose();mf=create();await mf.ready;const n=settles;
    assert.equal((await pay(paidRequest)).status,200);assert.equal(settles,n);
    const metrics=await send(owner,'metrics',{});assert.equal(metrics.result.billing.collected_usdc_atomic,'0');assert.equal(metrics.result.commercial_revenue_proven,false);assert.ok(BigInt(metrics.result.billing.simulated.collected_usdc_atomic)>0n);
  });
  await test('disabled agent cannot create new spend but owner can recover holds',async()=>{
    assert.equal((await send(agent,'authorize',input('disable_agent_hold'))).status,200);
    assert.equal((await send(owner,'disable-agent',{agent_id:agent.id})).status,200);
    assert.equal((await send(agent,'execute',{operation_id:'disable_agent_hold'})).status,403);
    assert.equal((await send(owner,'cancel',{operation_id:'disable_agent_hold'})).status,200);
  });
  await test('owner rotation requires both key proofs and preserves historical chain verification',async()=>{
    const next=await createIdentity(),nonce=crypto.randomUUID().replaceAll('-','');
    const proof={protocol:'xguard-afa-owner-rotation/1',org_id:org,previous_owner_id:owner.id,new_owner_id:next.id,nonce};
    const signature=b64(await crypto.subtle.sign({name:'ECDSA',hash:'SHA-256'},next.privateKey,bytes(proof)));
    assert.equal((await send(owner,'rotate-owner',{new_owner_key:next.publicKey,new_owner_proof:signature},org,{nonce})).status,200);
    assert.equal((await send(owner,'metrics',{})).status,401);assert.equal((await send(next,'metrics',{})).status,200);
    assert.equal((await send(parent,'authorize',input('historical_root_after_rotation',parentGrant))).status,200);
    assert.equal((await send(next,'cancel',{operation_id:'historical_root_after_rotation'})).status,200);
  });
  await test('deployed metadata blocks fee activation even with a simulation flag',async()=>{
    await mf.dispose();mf=create(true);await mf.ready;
    const n=settles,r=await pay(paidRequest);assert.equal(r.status,503);assert.equal((await r.json()).error,'authority_fee_activation_required');assert.equal(settles,n);
  });
  const result={tests_passed:tests.length,tests,real_transfers:0,real_service_fee_revenue:'0',network:'closed in-process fixtures only',fee_settlement_calls:settles,signature_verifications:verifies,measured_authority_resources:measuredCommerceResources,independent_security_audit:false,generated_at:new Date().toISOString()};
  if(process.env.AFA_COMMERCE_EVIDENCE_DIR){await mkdir(process.env.AFA_COMMERCE_EVIDENCE_DIR,{recursive:true});await writeFile(join(process.env.AFA_COMMERCE_EVIDENCE_DIR,'commerce-security.json'),JSON.stringify(result,null,2)+'\n');}
  console.log(JSON.stringify(result));
} finally {if(mf)await mf.dispose();await rm(persist,{recursive:true,force:true});}
