import test from 'node:test';
import assert from 'node:assert/strict';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { decodeFunctionData, parseTransaction, encodeEventTopics, encodeAbiParameters, erc20Abi, keccak256 } from 'viem';
import { authorizationTypes, eip3009ABI } from '@x402/evm';
import { ExactEvmScheme } from '@x402/evm/exact/facilitator';
import { storage } from './live-harness.mjs';
import { NativeSettlementEngine } from '../src/native-settlement/engine.js';
import { SqliteSettlementRepository } from '../src/native-settlement/repository.js';
import { SecureSimulationSigningAdapter } from '../src/native-settlement/transaction.js';
import { BASE_NETWORK, BASE_USDC, inspectNative } from '../src/native-settlement/policy.js';

async function fixture() {
  const payer = privateKeyToAccount(generatePrivateKey()), signerAccount = privateKeyToAccount(generatePrivateKey());
  const db = storage(), repository = new SqliteSettlementRepository(db);
  const requirements = { scheme:'exact',network:BASE_NETWORK,asset:BASE_USDC,amount:'1000',payTo:'0x2222222222222222222222222222222222222222',maxTimeoutSeconds:120,extra:{name:'USD Coin',version:'2'} };
  const simulator = {
    isSimulation:true, sent:0, signed:0, receipts:new Map(),used:new Set(),head:100n,receiptMode:'confirmed', gas:100000n,
    async getChainId(){if(this.fail==='rpc')throw Error('RPC offline');return this.chainId??8453;},
    async getCode({address}){if(this.fail==='rpc')throw Error('RPC offline');return address.toLowerCase()===BASE_USDC.toLowerCase()?'0x6000':'0x';},
    async readContract({functionName,args}){
      if(this.fail==='rpc')throw Error('RPC offline');
      if(functionName==='authorizationState')return this.used.has(args[1]);
      if(functionName==='balanceOf')return 1000000000n;
      if(functionName==='transferWithAuthorization')return true;
      throw Error('Unexpected simulated contract call');
    },
    async estimateGas(){return this.gas;},async estimateFeesPerGas(){return{maxFeePerGas:1000000n,maxPriorityFeePerGas:100n};},async getTransactionCount(){return 0;},
    async broadcastRawTransaction(raw){
      this.sent++;const hash=keccak256(raw), tx=parseTransaction(raw), {args}=decodeFunctionData({abi:eip3009ABI,data:tx.data});
      const record=[...db.db.prepare('SELECT record_json FROM native_settlements').all()].map(r=>JSON.parse(r.record_json)).find(r=>r.hash===hash);
      assert.equal(record.state,'SUBMITTING');assert.equal(record.raw,raw);assert.equal(tx.chainId,8453);
      const [from,to,value,,,nonce]=args;this.used.add(nonce);
      const logs=[{address:BASE_USDC,topics:encodeEventTopics({abi:erc20Abi,eventName:'Transfer',args:{from,to}}),data:encodeAbiParameters([{type:'uint256'}],[value])}];
      this.receipts.set(hash,{transactionHash:hash,status:'success',to:BASE_USDC,blockNumber:99n,blockHash:'0x'+'a'.repeat(64),logs});
      if(this.fail==='lost-broadcast-response')throw Error('Connection lost after acceptance');
      return hash;
    },
    async getTransactionReceipt(hash){
      if(this.fail==='receipt-rpc')throw Error('Receipt RPC failed');
      if(this.receiptMode==='missing')return null;
      const receipt=structuredClone(this.receipts.get(hash));
      if(this.receiptMode==='reverted')receipt.status='reverted';
      if(this.receiptMode==='wrong-event')receipt.logs=[];
      if(this.receiptMode==='one-confirmation')receipt.blockNumber=this.head;
      return receipt;
    },
    async getBlock(){return{hash:'0x'+(this.receiptMode==='reorg'?'b':'a').repeat(64)};},async getBlockNumber(){return this.head;},
  };
  const signer=new SecureSimulationSigningAdapter(signerAccount,simulator), original=signer.sign.bind(signer);
  signer.sign=async(...args)=>{simulator.signed++;return original(...args);};
  const engine=new NativeSettlementEngine({repository,rpc:simulator,signer,mode:'simulation'});
  async function payment(overrides={},req=requirements,domain={}) {
    const now=Math.floor(Date.now()/1000),authorization={from:payer.address,to:req.payTo,value:req.amount,validAfter:String(now-10),validBefore:String(now+100),nonce:'0x'+generatePrivateKey().slice(2),...overrides};
    const signature=await payer.signTypedData({domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:BASE_USDC,...domain},types:authorizationTypes,primaryType:'TransferWithAuthorization',message:{...authorization,value:BigInt(authorization.value),validAfter:BigInt(authorization.validAfter),validBefore:BigInt(authorization.validBefore)}});
    return{x402Version:2,accepted:structuredClone(req),payload:{authorization,signature}};
  }
  return{db,repository,requirements,simulator,signer,engine,payment,close:()=>db.db.close()};
}

test('real EIP-712 signatures agree with the official x402 v2 verifier without providers',async()=>{
  const f=await fixture();try{const p=await f.payment();assert.equal((await f.engine.verify(p,f.requirements)).isValid,true);assert.equal((await new ExactEvmScheme(f.simulator).verify(p,f.requirements)).isValid,true);assert.equal(f.simulator.sent,0);}finally{f.close();}
});
test('fresh native engine is disabled; a production transport cannot enter the simulation signer',async()=>{
  const f=await fixture();try{const e=new NativeSettlementEngine({repository:f.repository,rpc:f.simulator,signer:f.signer});assert.equal((await e.settle(await f.payment(),f.requirements,'disabled-key')).errorReason,'native_settlement_disabled');assert.throws(()=>new SecureSimulationSigningAdapter({},{}),/production_signing_disabled/);assert.equal(f.simulator.signed,0);assert.equal(e.status().production_signer,false);}finally{f.close();}
});
test('invalid signature, expiry, early validity, wrong network/asset/payTo/amount/domain and unsupported wallets fail before signing',async t=>{
  const cases={
    signature:async f=>{const p=await f.payment();p.payload.signature='0x'+'11'.repeat(65);return p;},
    expired:f=>f.payment({validBefore:String(Math.floor(Date.now()/1000)-1)}),
    future:f=>f.payment({validAfter:String(Math.floor(Date.now()/1000)+30)}),
    network:async f=>{const p=await f.payment();p.accepted.network='eip155:1';return p;},
    asset:async f=>{const p=await f.payment();p.accepted.asset=f.requirements.payTo;return p;},
    recipient:f=>f.payment({to:'0x3333333333333333333333333333333333333333'}),
    amount:f=>f.payment({value:'1001'}),
    domain:f=>f.payment({},f.requirements,{chainId:1}),
    window:f=>f.payment({validBefore:String(Math.floor(Date.now()/1000)+3600)}),
    permit2:async f=>{const p=await f.payment();p.payload.permit2Authorization={};return p;},
    chain:async f=>{f.simulator.chainId=1;return f.payment();},
    used:async f=>{const p=await f.payment();f.simulator.used.add(p.payload.authorization.nonce);return p;},
  };
  for(const [name,make]of Object.entries(cases))await t.test(name,async()=>{const f=await fixture();try{const result=await f.engine.settle(await make(f),f.requirements,'invalid-'+name);assert.equal(result.success,false);assert.notEqual(result.errorReason,'settlement_pending');assert.equal(f.simulator.signed,0);assert.equal(f.simulator.sent,0);assert.equal(f.db.db.prepare('SELECT count(*) AS n FROM native_settlements').get().n,0);}finally{f.close();}});
});
test('concurrent settlement claims broadcast once and keep an immutable audit',async()=>{
  const f=await fixture();try{const p=await f.payment();const results=await Promise.all(Array.from({length:24},()=>f.engine.settle(p,f.requirements,'concurrent-key')));assert.equal(f.simulator.sent,1);assert.equal(f.simulator.signed,1);assert.ok(results.some(r=>r.success));assert.ok(results.every(r=>r.success||r.errorReason==='settlement_pending'));const receipt=results.find(r=>r.success);assert.equal(receipt.confirmations,2);assert.equal(receipt.financial_value_moved,false);assert.throws(()=>f.db.sql.exec('DELETE FROM native_audit'),/immutable_native_audit/);}finally{f.close();}
});
test('exact idempotent retries return the original confirmed receipt; replay and changed input cannot charge twice',async()=>{
  const f=await fixture();try{const p=await f.payment(),a=await f.engine.settle(p,f.requirements,'original-key');assert.equal(a.success,true);assert.deepEqual(await f.engine.settle(p,f.requirements,'original-key'),a);assert.equal((await f.engine.settle(p,f.requirements,'different-key')).errorReason,'authorization_replay');assert.equal((await f.engine.settle(await f.payment(),f.requirements,'original-key')).errorReason,'idempotency_conflict');const altered=structuredClone(p);altered.payload.signature='0x'+'12'.repeat(65);assert.equal((await f.engine.settle(altered,f.requirements,'original-key')).errorReason,'idempotency_conflict');assert.equal(f.simulator.sent,1);}finally{f.close();}
});
test('a bad signature cannot poison the authorization lock before a valid payment arrives',async()=>{
  const f=await fixture();try{const p=await f.payment(),bad=structuredClone(p);bad.payload.signature='0x'+'34'.repeat(65);assert.equal((await f.engine.settle(bad,f.requirements,'attacker-key')).success,false);assert.equal((await f.engine.settle(p,f.requirements,'genuine-key')).success,true);assert.equal(f.simulator.sent,1);}finally{f.close();}
});
test('a lost broadcast response reconciles after restart and authorization expiry without another signature or broadcast',async()=>{
  const f=await fixture(),now=Date.now;try{const p=await f.payment();f.simulator.fail='lost-broadcast-response';const first=await f.engine.settle(p,f.requirements,'lost-response-key');assert.equal(first.success,false);assert.match(first.transaction,/^0x[0-9a-f]{64}$/);Date.now=()=>now()+180000;f.simulator.fail=null;const restarted=new NativeSettlementEngine({repository:new SqliteSettlementRepository(f.db),rpc:f.simulator,signer:f.signer,mode:'simulation'});const recovered=await restarted.settle(p,f.requirements,'lost-response-key');assert.equal(recovered.success,true);assert.equal(f.simulator.sent,1);assert.equal(f.simulator.signed,1);}finally{Date.now=now;f.close();}
});
test('missing receipts, slow confirmations, receipt RPC failure and reorgs never report success',async t=>{
  for(const mode of ['missing','one-confirmation','wrong-event','reverted','reorg','rpc'])await t.test(mode,async()=>{const f=await fixture();try{if(mode==='rpc')f.simulator.fail='receipt-rpc';else f.simulator.receiptMode=mode;const r=await f.engine.settle(await f.payment(),f.requirements,'receipt-'+mode);assert.equal(r.success,false);assert.equal(f.simulator.sent,1);assert.ok(['settlement_pending','transfer_event_mismatch','transaction_reverted','noncanonical_receipt'].includes(r.errorReason),JSON.stringify(r));}finally{f.close();}});
});
test('RPC failure and gas cap reject without a transfer and classify the failure',async()=>{
  for(const fail of ['rpc','gas']){const f=await fixture();try{const p=await f.payment();if(fail==='gas')f.simulator.gas=300001n;else f.simulator.fail='rpc';const r=await f.engine.settle(p,f.requirements,'failure-'+fail);assert.equal(r.success,false);assert.equal(f.simulator.sent,0);assert.equal(f.simulator.signed,0);}finally{f.close();}}
});
test('partial state persistence failure cannot broadcast an unrecorded transaction; the recorded bytes recover safely',async()=>{
  const f=await fixture(),now=Date.now;try{const p=await f.payment(),transition=f.repository.transition.bind(f.repository);let interrupted=false;f.repository.transition=(...args)=>{if(args[3].state==='SUBMITTING'&&!interrupted){interrupted=true;throw Error('Simulated durable write failure');}return transition(...args);};assert.equal((await f.engine.settle(p,f.requirements,'partial-state-key')).success,false);assert.equal(f.simulator.sent,0);const recorded=f.repository.get(inspectNative(p,f.requirements).authorizationKey);assert.equal(recorded.state,'PREPARED');Date.now=()=>now()+31000;assert.equal((await f.engine.settle(p,f.requirements,'partial-state-key')).success,true);assert.equal(f.simulator.signed,1);assert.equal(f.simulator.sent,1);}finally{Date.now=now;f.close();}
});
test('different authorizations on the same signer reserve distinct durable transaction nonces',async()=>{
  const f=await fixture();try{const results=await Promise.all([f.engine.settle(await f.payment(),f.requirements,'nonce-key-one'),f.engine.settle(await f.payment(),f.requirements,'nonce-key-two')]);assert.ok(results.every(r=>r.success));const records=f.db.db.prepare('SELECT record_json FROM native_settlements').all().map(r=>JSON.parse(r.record_json));assert.deepEqual(records.map(r=>r.unsigned.nonce).sort(),[0,1]);}finally{f.close();}
});
