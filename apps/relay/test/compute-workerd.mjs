import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { x402Client } from '@x402/core/client';
import { decodePaymentRequiredHeader, encodePaymentSignatureHeader } from '@x402/core/http';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { encodeAbiParameters, encodeEventTopics, parseAbiItem, verifyTypedData } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { canonicalize, digest } from '../src/compute/common.js';
import { createComputeClient, verifyComputeReceipt } from '../../../sdk/compute.js';

// Real Worker/SQLite, ES256 receipts and official x402 client. Every external
// call is intercepted. These simulated settlements cannot establish cash,
// real upstream execution, permission to resell, or production profit.
const bundle = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
const payee = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07';
const usdc = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913';
const blockHash = '0x' + 'b'.repeat(64);
const model = { id: 'xguard/test', input_micros_per_million: 5000000, output_micros_per_million: 1000000, context_length: 32768, license_reviewed: true, terms_reference: 'https://example.org/synthetic-model-terms' };
const policy = { enabled: true, resale_approved: true, permission_reference: 'https://example.org/synthetic-fixture-permission', reviewed_at: new Date().toISOString(), allowed_countries: ['JO'], daily_cap_atomic: 100000, request_cap_atomic: 10000, prepaid_available_atomic: 100000, low_balance_atomic: 100, hard_cost_bound_verified: true, models: [model] };
let mode = 'success', allowChain = true, modelPrice = '0.000005';
const counts = { settlements: 0, openrouter: 0, together: 0, gpu: 0 };
const authorizations = new Map(), transactions = new Map();
const types = { TransferWithAuthorization: ['from:address', 'to:address', 'value:uint256', 'validAfter:uint256', 'validBefore:uint256', 'nonce:bytes32'].map(x => { const [name, type] = x.split(':'); return { name, type }; }) };
const events = [parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'), parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)')];
const worker = {
  name: 'compute-fixture', modules: true, modulesRoot: dirname(bundle), scriptPath: bundle, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { PROOF_AUTHORITY: { className: 'ProofAuthority', useSQLite: true }, PAID_GATEWAY: { className: 'PaidGatewayState', useSQLite: true } },
  bindings: { XGUARD_COMPUTE_ENABLED: 'on', LIVE_BOOTSTRAP: 'off', XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_TREASURY_USDC_ADDRESS: payee, BASE_RPC_URL: 'https://chain.test', OPENROUTER_API_KEY: 'synthetic-not-a-real-credential', TOGETHER_API_KEY: 'synthetic-not-a-real-credential', RUNPOD_API_KEY: 'synthetic-not-a-real-credential', LIVE_ADMIN_KEY: 'synthetic-operator-credential-for-fixture-only', XGUARD_COMPUTE_PROVIDERS: JSON.stringify({ openrouter: policy, together: { ...policy, models: [{ ...model, input_micros_per_million: 5100000, output_micros_per_million: 1020000 }] }, runpod: { ...policy, jobs: [{ id: 'reviewed-fixture', endpoint_id: 'fixture-endpoint', image_digest: 'fixture/image@sha256:' + '1'.repeat(64), gpu_type: 'fixture-gpu', region: 'fixture-region', max_duration_seconds: 30, overhead_seconds: 10, max_micros_per_second: 10 }] } }) },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'api.runpod.ai') {
      if (url.pathname.endsWith('/health')) return MFResponse.json({ workers: { idle: 1 } });
      if (url.pathname.endsWith('/run')) { counts.gpu++; const body = await request.json(); assert.equal(body.policy.executionTimeout, 5000); assert.ok(body.policy.ttl < 100000); return MFResponse.json({ id: 'job-fixture-1', status: 'IN_QUEUE' }); }
      if (url.pathname.endsWith('/status/job-fixture-1')) return MFResponse.json({ id: 'job-fixture-1', status: 'COMPLETED', output: { answer: 'synthetic GPU result' }, executionTime: 5000 });
    }
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/key') return MFResponse.json({ data: { limit_remaining: 100 } });
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/credits') return MFResponse.json({ data: { total_credits: 100, total_usage: 0 } });
    if (url.hostname === 'api.together.ai' && url.pathname === '/v1/models') return MFResponse.json([{ id: model.id }]);
    if (url.hostname === 'openrouter.ai' && url.pathname === '/api/v1/models') return MFResponse.json({ data: [{ id: model.id, context_length: 32768, architecture: { input_modalities: ['text'] }, pricing: { prompt: modelPrice, completion: '0.000001', request: '0' } }] });
    if (['openrouter.ai', 'api.together.ai'].includes(url.hostname)) {
      const provider = url.hostname === 'openrouter.ai' ? 'openrouter' : 'together'; counts[provider]++;
      assert.ok(counts.settlements > 0, 'No upstream execution before settlement');
      assert.equal(allowChain, true, 'No upstream execution before canonical chain evidence');
      const body = await request.json(); assert.equal(body.stream, false); assert.equal(body.n, 1);
      if (provider === 'openrouter' && mode === 'rate-limit') return MFResponse.json({ error: 'rate limit' }, { status: 429 });
      if (provider === 'openrouter' && mode === 'ambiguous') throw new Error('simulated connection lost after provider accepted job');
      if (provider === 'openrouter' && mode === 'denied') return MFResponse.json({ error: 'restricted' }, { status: 403 });
      return MFResponse.json({ id: 'synthetic-completion', model: model.id, choices: [{ index: 0, message: { role: 'assistant', content: 'Synthetic fixture response.' }, finish_reason: 'stop' }], usage: { prompt_tokens: 15, completion_tokens: 5, ...(provider === 'openrouter' ? { cost: '0.000250' } : {}) } });
    }
    if (url.hostname === 'facilitator.test') {
      const { paymentPayload, paymentRequirements } = await request.json(); const a = paymentPayload.payload.authorization;
      if (url.pathname === '/verify') {
        const valid = await verifyTypedData({ address: a.from, types, primaryType: 'TransferWithAuthorization', domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: paymentRequirements.asset }, message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }, signature: paymentPayload.payload.signature });
        return MFResponse.json({ isValid: valid, payer: a.from });
      }
      assert.equal(url.pathname, '/settle'); counts.settlements++;
      const hash = '0x' + counts.settlements.toString(16).padStart(64, '0'); authorizations.set(hash, a); transactions.set(a.nonce, hash);
      return MFResponse.json({ success: true, network: 'eip155:8453', transaction: hash, payer: a.from });
    }
    if (url.hostname === 'chain.test') {
      const { id, method, params } = await request.json();
      const rpc = result => MFResponse.json({ jsonrpc: '2.0', id, result });
      if (method === 'eth_chainId') return rpc('0x2105');
      if (method === 'eth_blockNumber') return rpc('0x1002');
      if (method === 'eth_getBlockByNumber') return rpc({ hash: blockHash, number: '0x1000', transactions: [] });
      if (method === 'eth_getLogs') {
        const nonce = params[0].topics[2], hash = transactions.get(nonce); return rpc(hash && allowChain ? [{ transactionHash: hash, blockHash, blockNumber: '0x1000', address: usdc, data: '0x', topics: params[0].topics, logIndex: '0x0', transactionIndex: '0x0', removed: false }] : []);
      }
      assert.equal(method, 'eth_getTransactionReceipt');
      if (!allowChain) return rpc(null);
      const a = authorizations.get(params[0]); assert.ok(a);
      const common = { address: usdc, blockHash, blockNumber: '0x1000', transactionHash: params[0], transactionIndex: '0x0', removed: false };
      const logs = [{ ...common, logIndex: '0x0', data: '0x', topics: encodeEventTopics({ abi: events, eventName: 'AuthorizationUsed', args: { authorizer: a.from, nonce: a.nonce } }) }, { ...common, logIndex: '0x1', data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(a.value)]), topics: encodeEventTopics({ abi: events, eventName: 'Transfer', args: { from: a.from, to: payee } }) }];
      return rpc({ ...common, from: a.from, to: usdc, cumulativeGasUsed: '0x5208', effectiveGasPrice: '0x1', gasUsed: '0x5208', logs, logsBloom: '0x' + '0'.repeat(512), status: '0x1', type: '0x2' });
    }
    throw new Error('Real network access is prohibited in the compute fixture: ' + url.hostname);
  },
};
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [worker] }));
const account = privateKeyToAccount(generatePrivateKey());
const payer = new x402Client().register('eip155:8453', new ExactEvmScheme(account));
const input = { model: model.id, messages: [{ role: 'user', content: 'Explain gravity.' }], max_tokens: 64, max_amount_atomic: '10000', accept_provider_terms: true, preferred_provider: 'openrouter' };
const dispatch = (path, { key = 'compute-test-unique', headers = {}, body, method = body ? 'POST' : 'GET', country = 'JO' } = {}) => mf.dispatchFetch('https://api.xguardgate.com' + path, { method, cf: { country }, headers: { 'content-type': 'application/json', 'idempotency-key': key, ...headers }, ...(body ? { body: JSON.stringify(body) } : {}) });
async function quote(key, body = input) { const r = await dispatch('/v1/inference/quote', { key, body }); assert.equal(r.status, 200, await r.clone().text()); const q = await r.json(); const requirement = decodePaymentRequiredHeader(r.headers.get('payment-required')); const p = await payer.createPaymentPayload(requirement); return { q, requirement, payment: p, headers: { 'x-xguard-quote': q.quote, 'payment-signature': encodePaymentSignatureHeader(p) } }; }
try {
  await mf.ready;
  const q = await quote('compute-first-unique');
  assert.equal(q.q.price.markup_bps, 2500); assert.equal(counts.settlements, 0); assert.equal(counts.openrouter, 0);
  const signed = () => dispatch('/v1/inference/execute', { key: 'compute-first-unique', body: input, headers: q.headers });
  const concurrent = await Promise.all([signed(), signed()]);
  assert.ok(concurrent.every(r => [200, 202].includes(r.status)), await Promise.all(concurrent.map(r => r.clone().text())));
  const result = await (await signed()).json();
  assert.equal(result.status, 'SUCCEEDED'); assert.equal(counts.settlements, 1); assert.equal(counts.openrouter, 1);
  assert.ok(result.accounting.net_margin_atomic > 0); assert.equal(result.accounting.positive_margin_proven, false);
  const publicKey = await (await dispatch('/v1/compute/proof-key')).json();
  const key = await crypto.subtle.importKey('jwk', publicKey.jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  const [h, p, s] = result.receipt.split('.'); const bytes = part => Buffer.from(part, 'base64url');
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, bytes(s), Buffer.from(h + '.' + p)), true);
  assert.equal(JSON.parse(bytes(p)).response_digest, await digest(result.result));
  assert.equal(await verifyComputeReceipt(result, publicKey.jwk), true);
  assert.equal(await verifyComputeReceipt({ ...result, result: { tampered: true } }, publicKey.jwk), false);
  const originalCounts = { ...counts };
  const recovered = await dispatch('/v1/compute/executions/' + q.q.quote_id, { headers: { 'x-xguard-quote': q.q.quote } });
  assert.equal(recovered.status, 200); assert.deepEqual(counts, originalCounts);
  assert.equal((await dispatch('/v1/compute/receipts/' + q.q.quote_id)).status, 404);
  const changed = await dispatch('/v1/inference/execute', { key: 'compute-first-unique', body: { ...input, max_tokens: 65 }, headers: q.headers }); assert.equal(changed.status, 400);
  const repeat = await quote('compute-second-unique');
  const reused = { ...q.payment, accepted: repeat.requirement.accepts[0], extensions: repeat.requirement.extensions, resource: repeat.requirement.resource };
  const reject = await dispatch('/v1/inference/execute', { key: 'compute-second-unique', body: input, headers: { 'x-xguard-quote': repeat.q.quote, 'payment-signature': encodePaymentSignatureHeader(reused) } });
  assert.equal(reject.status, 409, await reject.clone().text()); assert.deepEqual(counts, originalCounts);
  mode = 'ambiguous'; const uncertain = await quote('compute-uncertain-unique');
  const u = await dispatch('/v1/inference/execute', { key: 'compute-uncertain-unique', body: input, headers: uncertain.headers });
  assert.equal((await u.json()).status, 'EXECUTION_UNKNOWN');
  const uncertainCounts = { ...counts };
  await dispatch('/v1/compute/executions/' + uncertain.q.quote_id, { headers: { 'x-xguard-quote': uncertain.q.quote } }); assert.deepEqual(counts, uncertainCounts);
  mode = 'rate-limit'; const fallback = await quote('compute-fallback-unique');
  const f = await dispatch('/v1/inference/execute', { key: 'compute-fallback-unique', body: input, headers: fallback.headers });
  const fallbackResult = await f.json(); assert.equal(f.status, 200, JSON.stringify(fallbackResult)); assert.equal(counts.together, 1); assert.equal(fallbackResult.accounting.upstream_cost_atomic, null); assert.equal(fallbackResult.accounting.net_margin_atomic, null);
  mode = 'denied'; const denied = await quote('compute-denied-unique');
  const d = await dispatch('/v1/inference/execute', { key: 'compute-denied-unique', body: input, headers: denied.headers });
  assert.equal((await d.json()).status, 'REFUND_REQUIRED'); assert.equal(counts.together, 1, 'Access restrictions must not fail over');
  mode = 'success'; allowChain = false; const pending = await quote('compute-chain-pending');
  const before = counts.openrouter;
  const b = await dispatch('/v1/inference/execute', { key: 'compute-chain-pending', body: input, headers: pending.headers }); assert.equal((await b.json()).status, 'SETTLEMENT_UNKNOWN'); assert.equal(counts.openrouter, before);
  allowChain = true;
  const settleCount = counts.settlements;
  const recoveredPayment = await dispatch('/v1/compute/executions/' + pending.q.quote_id, { headers: { 'x-xguard-quote': pending.q.quote } });
  assert.equal(recoveredPayment.status, 200, await recoveredPayment.clone().text()); assert.equal(counts.settlements, settleCount); assert.equal(counts.openrouter, before + 1);
  const wrongCountry = await dispatch('/v1/inference/quote', { key: 'compute-country-unique', body: input, country: 'XX' }); assert.equal(wrongCountry.status, 503); assert.equal(wrongCountry.headers.get('payment-required'), null);
  const gpuInput = { template: 'reviewed-fixture', gpu_type: 'fixture-gpu', region: 'fixture-region', duration_seconds: 5, input: { prompt: 'fixture' }, max_amount_atomic: '10000', accept_provider_terms: true };
  const gpuQuoteResponse = await dispatch('/v1/gpu/quote', { key: 'gpu-fixture-request', body: gpuInput });
  assert.equal(gpuQuoteResponse.status, 200, await gpuQuoteResponse.clone().text());
  const gpuQuote = await gpuQuoteResponse.json(), gpuPayment = await payer.createPaymentPayload(gpuQuote.payment);
  const gpuResponse = await dispatch('/v1/gpu/execute', { key: 'gpu-fixture-request', body: gpuInput, headers: { 'x-xguard-quote': gpuQuote.quote, 'payment-signature': encodePaymentSignatureHeader(gpuPayment) } });
  assert.equal(gpuResponse.status, 202, await gpuResponse.clone().text()); assert.equal(counts.gpu, 1);
  const gpuRecovery = await dispatch('/v1/compute/executions/' + gpuQuote.quote_id, { headers: { 'x-xguard-quote': gpuQuote.quote } });
  const gpuResult = await gpuRecovery.json(); assert.equal(gpuResult.status, 'SUCCEEDED'); assert.equal(counts.gpu, 1); assert.equal(await verifyComputeReceipt(gpuResult, publicKey.jwk), true); assert.equal(gpuResult.accounting.net_margin_atomic, null);
  const namespace = await mf.getDurableObjectNamespace('PAID_GATEWAY');
  const capStub = namespace.get(namespace.idFromName('compute-cap-fixture-v1'));
  const capCall = (action, body) => capStub.fetch('https://compute.internal/compute/' + action, { method: 'POST', body: JSON.stringify(body) });
  const quoteIds = [1, 2].map(() => 'xcq_' + crypto.randomUUID().replaceAll('-', ''));
  for (const quote_id of quoteIds) assert.equal((await capCall('quote', { record: { quote_id, expires_at: Date.now() + 120000, price: { upstream_cost_bound_atomic: 600 }, routes: [{ provider: 'openrouter' }] } })).status, 200);
  const capResults = await Promise.all(quoteIds.map((quote_id, index) => capCall('claim-payment', { quote_id, request_key: 'synthetic-cap-' + index, payment: {}, budgets: { request_cap_atomic: 1000, daily_cap_atomic: 1000, prepaid_available_atomic: 1000 } })));
  assert.deepEqual(capResults.map(r => r.status).sort(), [200, 503], 'Concurrent purchases cannot reserve the same prepaid capacity');
  const metricsResponse = await dispatch('/v1/compute/metrics', { headers: { authorization: 'Bearer ' + worker.bindings.LIVE_ADMIN_KEY } }); const metrics = await metricsResponse.json();
  assert.equal(metricsResponse.status, 200); assert.equal(metrics.successful_executions, 4); assert.equal(metrics.unknown_cost_executions, 2); assert.equal(metrics.failovers, 1);
  assert.equal((await dispatch('/v1/compute/metrics')).status, 401);
  const spec = await (await dispatch('/openapi.json')).json(); assert.ok(spec.paths['/v1/gpu/execute']);
  const health = await dispatch('/v1/compute/health'); assert.equal(health.status, 200);
  let prepared;
  const settlementCount = counts.settlements;
  const sdk = createComputeClient({ payer, maxAmountAtomic: '10000', fetchImpl: (url, init) => mf.dispatchFetch(url, { ...init, cf: { country: 'JO' } }), onPaymentPrepared: value => { prepared = value; throw new Error('simulated client interruption before submission'); } });
  await assert.rejects(() => sdk.request('inference', input), /simulated client interruption/);
  assert.equal(counts.settlements, settlementCount);
  const resumedPurchase = await sdk.recover(prepared);
  assert.equal(resumedPurchase.status, 200, await resumedPurchase.clone().text()); assert.equal(counts.settlements, settlementCount + 1);
  assert.equal(await verifyComputeReceipt(await resumedPurchase.json(), publicKey.jwk), true);
  console.log(JSON.stringify({ compute_workerd: 'passed', official_x402_signer: true, real_sqlite_claims: true, canonical_settlement_before_execution: true, receipt_signature_verified: true, concurrent_retries_execute_once: true, uncertain_execution_never_failed_over: true, explicit_429_failover: true, access_denial_not_bypassed: true, settlement_recovery_without_repayment: true, unknown_cost_not_profit: true, production_money_moved: false, actual_upstream_execution: false }));
} finally { await mf.dispose(); }
