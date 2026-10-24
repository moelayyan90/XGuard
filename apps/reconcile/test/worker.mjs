import assert from 'node:assert/strict';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse, Log, LogLevel } from 'miniflare';
import { x402Client } from '@x402/core/client';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData, toEventSelector, padHex } from 'viem';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

const bundle = fileURLToPath(new URL('../build/worker.mjs', import.meta.url));
const treasury = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07', asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
const authorizer = '0x' + '1'.repeat(40), nonce = '0x' + '1'.repeat(64), transaction = '0x' + '2'.repeat(64);
const url = `https://reconcile.xguardgate.com/v1/reconcile?from=${authorizer}&nonce=${nonce}`;
const counts = { supported: 0, verify: 0, settle: 0, rpc: 0 };
let rejectVerify = false, rejectSettle = false, failVerify = false, failRpc = false, used = false;
const messages = [];
class CaptureLog extends Log { log(message) { messages.push(String(message)); } }
const types = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
const outbound = async request => {
  const address = new URL(request.url);
  if (address.hostname === 'unavailable.test') return MFResponse.json({ error: 'fixture outage' }, { status: 503 });
  if (address.hostname === 'facilitator.test') {
    if (address.pathname === '/supported') { counts.supported++; return MFResponse.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }, { x402Version: 2, scheme: 'exact', network: 'eip155:84532' }, { x402Version: 1, scheme: 'exact', network: 'base' }, { x402Version: 1, scheme: 'exact', network: 'base-sepolia' }], extensions: [], signers: { 'eip155:*': ['0x2772F7F74ac0aCA38C6238aA5EcE72B27bEB8C17'] } }); }
    const { paymentPayload: payment, paymentRequirements: requirements } = await request.json();
    if (address.pathname === '/verify') {
      if (failVerify) return MFResponse.json({ error: 'fixture verify outage' }, { status: 503 });
      counts.verify++; const auth = payment.payload.authorization;
      const valid = await verifyTypedData({ address: auth.from, domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: requirements.asset }, types, primaryType: 'TransferWithAuthorization', message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) }, signature: payment.payload.signature });
      assert.equal(valid, true); return MFResponse.json({ isValid: !rejectVerify, invalidReason: rejectVerify ? 'invalid_signature' : undefined, payer: auth.from });
    }
    assert.equal(address.pathname, '/settle'); counts.settle++;
    return MFResponse.json({ success: !rejectSettle, errorReason: rejectSettle ? 'fixture_settlement_rejected' : undefined, network: 'eip155:8453', transaction: rejectSettle ? '' : transaction, payer: payment.payload.authorization.from });
  }
  assert.equal(address.hostname, 'rpc.test', 'Live providers and funded wallets are prohibited in this fixture');
  counts.rpc++; if (failRpc) return MFResponse.json({ error: 'fixture rpc outage' }, { status: 503 });
  const body = await request.json(); let result;
  if (body.method === 'eth_call') result = '0x' + (used ? '1' : '0').padStart(64, '0');
  else if (body.method === 'eth_blockNumber') result = '0x2710';
  else { assert.equal(body.method, 'eth_getLogs'); result = [{ address: asset, blockHash: '0x' + '3'.repeat(64), blockNumber: '0x2700', transactionHash: transaction, transactionIndex: '0x0', logIndex: '0x0', data: '0x', topics: [toEventSelector('AuthorizationUsed(address,bytes32)'), padHex(authorizer, { size: 32 }), nonce], removed: false }]; }
  return MFResponse.json({ jsonrpc: '2.0', id: body.id, result });
};
const bindings = { XGUARD_TREASURY_USDC_ADDRESS: treasury, X402_FACILITATOR: 'https://facilitator.test', BASE_RPC_URL: 'https://rpc.test', CF_VERSION_METADATA: { tag: 'fixture-reconcile' } };
const workers = ['normal', 'unconfigured', 'unavailable'].map(name => ({ name, modules: true, modulesRoot: resolve(bundle, '..'), scriptPath: bundle, compatibilityDate: '2026-08-26', compatibilityFlags: ['nodejs_compat'], bindings: { ...bindings, ...(name === 'unconfigured' ? { XGUARD_TREASURY_USDC_ADDRESS: '' } : {}), ...(name === 'unavailable' ? { X402_FACILITATOR: 'https://unavailable.test' } : {}) }, outboundService: outbound }));
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: resolve(bundle, '..'), log: new CaptureLog(LogLevel.DEBUG), workers }));
try {
  await mf.ready; const worker = await mf.getWorker('normal'), unconfigured = await mf.getWorker('unconfigured'), unavailable = await mf.getWorker('unavailable');
  for (const path of ['/', '/healthz', '/docs', '/openapi.json', '/.well-known/x402.json', '/robots.txt', '/sitemap.xml', '/llms.txt']) assert.equal((await worker.fetch('https://reconcile.xguardgate.com' + path)).status, 200);
  assert.equal((await unconfigured.fetch('https://reconcile.xguardgate.com/unknown')).status, 404);
  assert.equal((await worker.fetch(url, { method: 'POST' })).status, 404);
  assert.equal((await worker.fetch('https://reconcile.xguardgate.com/v1/reconcile?from=bad')).status, 400);
  assert.equal((await unconfigured.fetch(url)).status, 503); assert.deepEqual(counts, { supported: 0, verify: 0, settle: 0, rpc: 0 });
  const bare = await worker.fetch('https://reconcile.xguardgate.com/v1/reconcile'); assert.equal(bare.status, 402);
  const challenge = await worker.fetch(url); assert.equal(challenge.status, 402, await challenge.clone().text());
  const required = JSON.parse(Buffer.from(challenge.headers.get('payment-required'), 'base64').toString()); assert.equal(required.accepts[0].amount, '2000'); assert.equal(required.accepts[0].network, 'eip155:8453'); assert.equal(required.accepts[0].asset.toLowerCase(), asset.toLowerCase()); assert.equal(required.accepts[0].payTo.toLowerCase(), treasury);
  assert.ok(required.extensions.bazaar.schema); assert.equal(counts.rpc, 0);
  const payer = new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
  const paid = async () => { const payload = await payer.createPaymentPayload(required); return worker.fetch(url, { headers: { 'payment-signature': encodePaymentSignatureHeader(payload) } }); };
  const response = await paid(); assert.equal(response.status, 200, await response.clone().text());
  assert.equal((await response.json()).authorization_used, false); assert.ok(response.headers.get('payment-response')); assert.equal(counts.settle, 1);
  used = true; const observed = await paid(); assert.equal(observed.status, 200); assert.equal((await observed.json()).transaction, transaction); assert.equal(counts.settle, 2);
  rejectVerify = true; const beforeRpc = counts.rpc; const rejected = await paid(); assert.equal(rejected.status, 402); assert.equal(counts.rpc, beforeRpc); assert.equal(counts.settle, 2); rejectVerify = false;
  const malformed = await worker.fetch(url, { headers: { 'payment-signature': 'malformed' } }); assert.equal(malformed.status, 402); assert.equal(counts.settle, 2);
  rejectSettle = true; const settlementFailure = await paid(); assert.equal(settlementFailure.status, 402);
  const failureAcknowledgement = JSON.parse(Buffer.from(settlementFailure.headers.get('payment-response'), 'base64').toString());
  assert.equal(failureAcknowledgement.success, false); assert.equal((await settlementFailure.json()).authorization_used, undefined); rejectSettle = false;
  failVerify = true; const beforeOutage = { ...counts }; const verifyOutage = await paid(); assert.ok([402, 503].includes(verifyOutage.status)); assert.equal((await verifyOutage.json()).authorization_used, undefined); assert.equal(counts.rpc, beforeOutage.rpc); assert.equal(counts.settle, beforeOutage.settle); failVerify = false;
  failRpc = true; const settlementsBeforeRpcFailure = counts.settle; const rpcFailure = await paid(); assert.equal(rpcFailure.status, 503); assert.equal(counts.settle, settlementsBeforeRpcFailure);
  const dependency = await unavailable.fetch(url); assert.equal(dependency.status, 503, await dependency.clone().text());
  assert.ok(!messages.some(x => /Error compiling schema|Schema validation failed|Code generation from strings|Failed to load bazaar/.test(x)), messages.filter(x => /schema|bazaar/i.test(x)).join('\n'));
  console.log(JSON.stringify({ workerd: 'passed', statuses: [200, 400, 402, 404, 503], schema_validation: 'precompiled-equivalent', unknown_route_payment_initialization: 0, cryptographic_payment_authorizations: true, successful_simulated_settlements: 2, rejected_settlement_delivered: false, rpc_failure_settled: false, real_money_moved: false }));
} finally { await mf.dispose(); }
