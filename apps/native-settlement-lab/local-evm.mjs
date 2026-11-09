import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ganache from 'ganache';
import solc from 'solc';
import { createPublicClient, createWalletClient, custom, defineChain, getAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { authorizationTypes } from '../relay/node_modules/@x402/evm/dist/esm/index.mjs';
import { storage } from '../relay/test/live-harness.mjs';
import { NativeSettlementEngine } from '../relay/src/native-settlement/engine.js';
import { SqliteSettlementRepository } from '../relay/src/native-settlement/repository.js';
import { SecureSimulationSigningAdapter } from '../relay/src/native-settlement/transaction.js';
import { BASE_NETWORK, BASE_USDC } from '../relay/src/native-settlement/policy.js';

// In-process provider, with no HTTP server, fork option or external RPC URL.
// Every balance and block belongs to this disposable local EVM.
const gasKey=generatePrivateKey(), gasAccount=privateKeyToAccount(gasKey), payer=privateKeyToAccount(generatePrivateKey());
const chain=defineChain({id:8453,name:'XGuard disposable in-process EVM',nativeCurrency:{name:'Fake ETH',symbol:'TEST',decimals:18},rpcUrls:{default:{http:[]}}});
const provider=ganache.provider({chain:{chainId:8453,networkId:8453,hardfork:'shanghai'},wallet:{accounts:[{secretKey:gasKey,balance:'0xde0b6b3a7640000'}]},logging:{quiet:true}});
const client=createPublicClient({chain,transport:custom(provider)}), wallet=createWalletClient({chain,account:gasAccount,transport:custom(provider)});
const db=storage();let broadcasts=0;
try {
  const input={language:'Solidity',sources:{'MockUSDC.sol':{content:await readFile(new URL('MockUSDC.sol',import.meta.url),'utf8')}},settings:{evmVersion:'shanghai',optimizer:{enabled:true,runs:200},viaIR:true,outputSelection:{'*':{'*':['abi','evm.deployedBytecode.object']}}}};
  const compiled=JSON.parse(solc.compile(JSON.stringify(input)));
  assert.deepEqual((compiled.errors||[]).filter(e=>e.severity==='error'),[]);
  const contract=compiled.contracts['MockUSDC.sol'].MockUSDC;
  await provider.request({method:'evm_setAccountCode',params:[BASE_USDC,'0x'+contract.evm.deployedBytecode.object]});
  await wallet.writeContract({address:BASE_USDC,abi:contract.abi,functionName:'mint',args:[payer.address,1000000n]});
  const before=await client.readContract({address:BASE_USDC,abi:contract.abi,functionName:'balanceOf',args:[payer.address]});
  const rpc={
    isSimulation:true,
    getChainId:()=>client.getChainId(), getCode:args=>client.getCode(args),
    readContract:args=>client.readContract({...args,abi:args.abi||contract.abi}),
    estimateGas:intent=>client.estimateGas({...intent,account:gasAccount.address,value:0n}),
    estimateFeesPerGas:()=>client.estimateFeesPerGas(),
    getTransactionCount:address=>client.getTransactionCount({address,blockTag:'pending'}),
    async broadcastRawTransaction(raw){broadcasts++;const hash=await client.sendRawTransaction({serializedTransaction:raw});await provider.request({method:'evm_mine',params:[]});return hash;},
    async getTransactionReceipt(hash){try{return await client.getTransactionReceipt({hash});}catch(e){if(e.name==='TransactionReceiptNotFoundError')return null;throw e;}},
    getBlock:blockNumber=>client.getBlock({blockNumber:BigInt(blockNumber)}),getBlockNumber:()=>client.getBlockNumber({cacheTime:0}),
  };
  const requirements={scheme:'exact',network:BASE_NETWORK,asset:BASE_USDC,amount:'1000',payTo:'0x2222222222222222222222222222222222222222',maxTimeoutSeconds:120,extra:{name:'USD Coin',version:'2'}};
  const now=Math.floor(Date.now()/1000),authorization={from:payer.address,to:requirements.payTo,value:'1000',validAfter:String(now-10),validBefore:String(now+100),nonce:generatePrivateKey()};
  const signature=await payer.signTypedData({domain:{name:'USD Coin',version:'2',chainId:8453,verifyingContract:BASE_USDC},types:authorizationTypes,primaryType:'TransferWithAuthorization',message:{...authorization,value:1000n,validAfter:BigInt(authorization.validAfter),validBefore:BigInt(authorization.validBefore)}});
  const payment={x402Version:2,accepted:requirements,payload:{authorization,signature}};
  const repository=new SqliteSettlementRepository(db), signer=new SecureSimulationSigningAdapter(gasAccount,rpc);
  const engine=new NativeSettlementEngine({repository,rpc,signer,mode:'simulation'});
  assert.equal((await engine.verify(payment,requirements)).isValid,true);
  const receipt=await engine.settle(payment,requirements,'local-evm-first-payment');assert.equal(receipt.success,true,JSON.stringify(receipt));
  assert.ok(receipt.confirmations>=2);assert.equal(receipt.financial_value_moved,false);
  const after=await client.readContract({address:BASE_USDC,abi:contract.abi,functionName:'balanceOf',args:[payer.address]});
  const received=await client.readContract({address:BASE_USDC,abi:contract.abi,functionName:'balanceOf',args:[getAddress(requirements.payTo)]});
  assert.equal(before-after,1000n);assert.equal(received,1000n);assert.equal(broadcasts,1);
  assert.deepEqual(await engine.settle(payment,requirements,'local-evm-first-payment'),receipt);
  assert.equal((await engine.settle(payment,requirements,'local-evm-replay')).errorReason,'authorization_replay');
  assert.equal((await engine.verify(payment,requirements)).isValid,false);assert.equal(broadcasts,1);
  console.log(JSON.stringify({local_evm:'passed',contract:'local MockUSDC, not Circle bytecode',eip712_signature:true,evm_signature_and_nonce_checks:true,exact_local_token_delta:'1000',confirmations:receipt.confirmations,idempotent_recovery:true,replay_rejected:true,broadcasts,external_rpc_requests:0,production_money_moved:false}));
} finally {db.db.close();await provider.disconnect();}
