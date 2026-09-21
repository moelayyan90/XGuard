import test from 'node:test';
import assert from 'node:assert/strict';
import { encodePaymentSignatureHeader } from '@x402/core/http';
import { privateKeyToAccount } from 'viem/accounts';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { createPaidAPIClient } from '../../../sdk/paid-api.js';
import { parseHTML } from 'linkedom';
import { runInNewContext } from 'node:vm';
import { encodeEventTopics, encodeAbiParameters, parseAbiItem } from 'viem';
import app, { PaidGatewayState, ProofAuthority, EgressKeyAuthority } from './canonical-entry.js';
import { sellerCall, sellerStore } from './seller-commerce.js';
import { splitSellerPrice, sellerFeePolicy, safeSellerBase, safeSellerPath } from './core/seller-policy.js';

// Fixture-only facilitator responses below are never production payment evidence.
class MemoryStorage {
  values = new Map();
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
  async delete(key) { return this.values.delete(key); }
  async setAlarm(time) { this.alarm = time; }
  async transaction(fn) { return fn(this); }
}
function ns(Class, env) {
  const objects = new Map(), queues = new Map();
  return { objects, idFromName: x => x, get(id) {
    if (!objects.has(id)) objects.set(id, new Class({ storage: new MemoryStorage(), blockConcurrencyWhile: f => f() }, env));
    return { fetch(input, init) {
      const task = (queues.get(id) || Promise.resolve()).then(() => objects.get(id).fetch(new Request(input, init)));
      queues.set(id, task.catch(() => {})); return task;
    } };
  } };
}
const treasury = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07';
const payer = '0x1111111111111111111111111111111111111111';
const transaction = `0x${'2'.repeat(64)}`;
function environment() {
  const env = { XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_TREASURY_USDC_ADDRESS: treasury, XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100', XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0', XGUARD_MIN_CONTRIBUTION_BPS: '2000', XGUARD_OPERATOR_METRICS_KEY: 'test-only-metrics-key' };
  env.PROOF_AUTHORITY = ns(ProofAuthority, env); env.PAID_GATEWAY = ns(PaidGatewayState, env); env.EGRESS_KEYS = ns(EgressKeyAuthority, env); return env;
}
const request = (env, path, init = {}) => app.fetch(new Request(`https://api.xguardgate.com${path}`, init), env, {});
const post = (env, path, body, token) => request(env, path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
async function onboard(env, changes = {}) {
  const registered = await post(env, '/v1/sellers', { name: 'Fixture seller' }); assert.equal(registered.status, 201, await registered.clone().text());
  const identity = await registered.json();
  const response = await post(env, '/v1/sellers/services', { service_name: 'Useful API', upstream_base_url: 'https://example.com/api/', allowed_methods: ['GET', 'POST'], price_atomic: '100000', payout_destination: treasury, ...changes }, identity.token);
  assert.equal(response.status, 201, await response.clone().text());
  return { ...identity, ...(await response.json()) };
}
function network(t, { valid = true, failExecution = false, secret = '', buyer = payer } = {}) {
  const calls = { verify: 0, settle: 0, upstream: 0, outgoing: null }; const previous = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) return Response.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (url.hostname === 'facilitator.test') {
      if (url.pathname === '/verify') { calls.verify++; return Response.json({ isValid: valid, payer: buyer, ...(!valid ? { invalidReason: 'invalid_signature' } : {}) }); }
      if (url.pathname === '/settle') { calls.settle++; return Response.json({ success: true, payer: buyer, transaction, network: 'eip155:8453' }); }
    }
    if (url.hostname === 'example.com') {
      calls.upstream++; calls.outgoing = init;
      assert.ok(calls.settle > 0, 'No upstream access before settlement');
      if (failExecution) throw new Error('fixture timeout');
      return Response.json({ data: 'useful fixture result', ...(secret ? { reflected: secret } : {}) });
    }
    throw new Error(`Unexpected fixture network access: ${url.hostname}${url.pathname}`);
  };
  t.after(() => { globalThis.fetch = previous; }); return calls;
}
async function challenge(env, endpoint, init = {}) {
  const response = await request(env, new URL(endpoint).pathname, init); assert.equal(response.status, 402, await response.clone().text());
  return { body: await response.json(), quote: response.headers.get('x-xguard-quote') };
}
function paidHeaders(quote, { nonce = '3', from = payer, traffic = 'synthetic' } = {}) {
  const q = quote.body;
  return { 'x-xguard-quote': quote.quote, 'x-xguard-traffic-class': traffic, 'payment-signature': encodePaymentSignatureHeader({ x402Version: 2, resource: q.resource, accepted: q.accepts[0], payload: { signature: `0x${'1'.repeat(130)}`, authorization: { from, to: q.accepts[0].payTo, value: q.accepts[0].amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${nonce.repeat(64)}` } }, extensions: { 'payment-identifier': { info: { id: q.extensions.xguard.paymentIdentifier } } } }) };
}

test('Fee policy supports percentage, fixed, minimum and overrides with exact integer rounding', () => {
  assert.deepEqual(splitSellerPrice('100000', sellerFeePolicy({})), { gross_atomic: '100000', platform_fee_atomic: '3000', seller_proceeds_atomic: '97000', policy: { bps: 300, fixed_atomic: 0, minimum_atomic: 0, rounding: 'ceil_to_atomic_unit' } });
  const policy = sellerFeePolicy({ XGUARD_PLATFORM_FEE_BPS: '0', XGUARD_FIXED_FEE_ATOMIC: '100', XGUARD_MINIMUM_FEE: '200' });
  assert.equal(splitSellerPrice('999', policy).platform_fee_atomic, '200');
  assert.equal(splitSellerPrice('101', { bps: 300, fixed_atomic: 2, minimum_atomic: 0 }).platform_fee_atomic, '6');
  assert.equal(sellerFeePolicy({ XGUARD_SELLER_FEE_OVERRIDES: '{"s":{"bps":500}}' }, 's').bps, 500);
  assert.throws(() => splitSellerPrice('1', sellerFeePolicy({})));
  assert.throws(() => sellerFeePolicy({ XGUARD_PLATFORM_FEE_BPS: '-1' }));
});

test('Seller registration isolates credentials; missing payout authority leaves external seller draft', async () => {
  const env = environment(); const seller = await onboard(env, { payout_destination: payer, upstream_auth: { header: 'authorization', prefix: 'Bearer ', secret: 'fixture-upstream-secret' } });
  assert.equal(seller.service.status, 'draft'); assert.equal(seller.activation.reason, 'payout_signer_not_configured');
  assert.ok(!JSON.stringify(seller).includes('fixture-upstream-secret'));
  const stored = await sellerCall(env, '/seller/service-get', { service_id: seller.service.service_id });
  assert.ok(stored.service.secret_envelope); assert.ok(!JSON.stringify(stored).includes('fixture-upstream-secret'));
  assert.equal((await request(env, new URL(seller.service.endpoint).pathname)).status, 503);
  assert.equal((await request(env, '/v1/sellers/dashboard')).status, 401);
  assert.equal((await request(env, '/internal/revenue-funnel')).status, 401);
  const catalog = await (await request(env, '/v1/marketplace/services')).json();
  assert.equal(catalog.services.length, 1); assert.equal(catalog.services[0].service_id, 'feed-digest');
});

test('Fixture paid proxy settles once, executes once, signs fee allocation and never inflates REAL revenue', async t => {
  const env = environment(), calls = network(t); const seller = await onboard(env);
  const quote = await challenge(env, seller.service.endpoint, { headers: { 'x-xguard-traffic-class': 'synthetic' } });
  assert.equal(calls.upstream, 0); assert.equal(quote.body.extensions.xguard.allocation.platform_fee_atomic, '3000');
  const path = new URL(seller.service.endpoint).pathname, headers = paidHeaders(quote);
  const first = await request(env, path, { headers }); assert.equal(first.status, 200, await first.clone().text());
  assert.deepEqual(await first.json(), { data: 'useful fixture result' });
  assert.ok(first.headers.get('x-xguard-receipt')); assert.ok(first.headers.get('x-xguard-proof'));
  const replay = await request(env, path, { headers }); assert.equal(replay.headers.get('x-xguard-replay'), 'true');
  assert.deepEqual({ v: calls.verify, s: calls.settle, u: calls.upstream }, { v: 1, s: 1, u: 1 });
  const verification = await post(env, '/v1/proofs/verify', { proof: first.headers.get('x-xguard-proof') });
  assert.equal(verification.status, 200); const proofResult = await verification.json(); assert.equal(proofResult.valid, true); const proof = proofResult.payload;
  assert.equal(proof.seller.platform_fee_atomic, '3000'); assert.equal(proof.seller.seller_proceeds_atomic, '97000');
  const revenue = await sellerCall(env, '/seller/summary'); assert.equal(revenue.classes.REAL.platform_fee_atomic, '0');
  assert.equal(revenue.classes.SYNTHETIC.platform_fee_atomic, '3000'); assert.equal(revenue.classes.SYNTHETIC.paid_transactions, 1);
  const payout = [...env.PAID_GATEWAY.objects.entries()].find(([id]) => id.includes(':payout:'))[1]; await payout.alarm(); await payout.alarm();
  const after = await sellerCall(env, '/seller/summary'); assert.equal(after.classes.SYNTHETIC.seller_payout_atomic, '0'); assert.equal(after.classes.SYNTHETIC.same_owner_retained_atomic, '97000');
  assert.equal(after.classes.SYNTHETIC.funnel.xguard_fee_earned, 1);
  const recovered = await request(env, `/v1/marketplace/results/${quote.body.extensions.xguard.paymentIdentifier}`, { headers: { 'x-xguard-quote': quote.quote } });
  assert.equal(recovered.status, 200); assert.equal(recovered.headers.get('x-xguard-replay'), 'true'); assert.equal(calls.upstream, 1);
  assert.equal((await request(env, `/v1/marketplace/results/${quote.body.extensions.xguard.paymentIdentifier}`)).status, 403);
});

test('Rejected authorization cannot reach settlement or upstream execution', async t => {
  const env = environment(), calls = network(t, { valid: false }), seller = await onboard(env);
  const q = await challenge(env, seller.service.endpoint);
  assert.equal((await request(env, new URL(seller.service.endpoint).pathname, { headers: paidHeaders(q) })).status, 402);
  assert.equal(calls.settle, 0); assert.equal(calls.upstream, 0);
  const summary = await sellerCall(env, '/seller/summary');
  assert.equal(summary.classes.SYNTHETIC.failed_payment_attempts, 1); assert.equal(summary.classes.SYNTHETIC.gross_atomic, '0');
});

test('Official x402 signer works with bounded paid API SDK and persists recovery before submission', async t => {
  // Well-known fixture key, only ever sent to the in-process fake facilitator.
  const account = privateKeyToAccount(`0x${'1'.repeat(64)}`), env = environment(), calls = network(t, { buyer: account.address });
  const seller = await onboard(env), payerClient = new x402Client().register('eip155:8453', new ExactEvmScheme(account));
  let recovery;
  const client = createPaidAPIClient({ payer: payerClient, maxAmountAtomic: '100000', trafficClass: 'synthetic', fetchImpl: (url, init) => app.fetch(new Request(url, init), env, {}), onPaymentPrepared: async data => { assert.equal(calls.settle, 0); recovery = data; } });
  const response = await client.request(seller.service.endpoint);
  assert.equal(response.status, 200, await response.clone().text()); assert.equal(response.headers.get('x-xguard-accounting-status'), 'recorded');
  assert.equal((await client.recover(recovery)).status, 200); assert.equal(calls.settle, 1);
  const capped = createPaidAPIClient({ payer: { createPaymentPayload() { throw Error('Must not sign'); } }, maxAmountAtomic: '1', fetchImpl: (url, init) => app.fetch(new Request(url, init), env, {}) });
  await assert.rejects(() => capped.request(seller.service.endpoint), /exceed/); assert.equal(calls.settle, 1);
});

test('Seller form executes registration and service creation with exact decimal price and no browser secret storage', async () => {
  const env = environment();
  const page = await app.fetch(new Request('https://xguardgate.com/sellers'), env, {}); const html = await page.text();
  const { document } = parseHTML(html);
  assert.equal(document.querySelector('link[rel="canonical"]').getAttribute('href'), 'https://xguardgate.com/sellers');
  assert.doesNotMatch(html, /localStorage|sessionStorage|\.innerHTML\s*=/);
  const script = document.querySelector('script');
  assert.ok(page.headers.get('content-security-policy').includes(script.getAttribute('nonce')));
  runInNewContext(script.textContent, { document, URL, fetch: (url, init) => app.fetch(new Request(url, init), env, {}) });
  for (const [id, value] of Object.entries({ upstream: 'https://example.com/data', price: '0.10', wallet: treasury, methods: 'GET', name: 'Form fixture' })) document.getElementById(id).value = value;
  await document.getElementById('create').onsubmit({ preventDefault() {} });
  const result = JSON.parse(document.getElementById('result').textContent);
  assert.equal(result.service.price.amount_atomic, '100000'); assert.equal(result.service.status, 'active');
  assert.equal(document.getElementById('secret').value, '');
  const dashboard = JSON.parse(document.getElementById('earnings').textContent); assert.equal(dashboard.earnings.earned_atomic, '0');
});

test('Ambiguous seller payout is reserved once and only uses read-only recovery afterwards', async t => {
  const env = environment(), account = privateKeyToAccount(`0x${'2'.repeat(64)}`);
  env.XGUARD_PAYOUT_PRIVATE_KEY = `0x${'2'.repeat(64)}`; env.XGUARD_TREASURY_USDC_ADDRESS = account.address;
  const operation_hash = 'a'.repeat(64);
  await sellerCall(env, '/seller/payout-create', { operation_hash, payout_destination: payer, seller_proceeds_atomic: '97000' }, `payout:${operation_hash}`);
  let settles = 0;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input);
    if (url.pathname === '/verify') return Response.json({ isValid: true, payer: account.address });
    if (url.pathname === '/settle') { settles++; throw new Error('Response lost after submission'); }
    const body = JSON.parse(init.body); assert.ok(['eth_chainId', 'eth_blockNumber', 'eth_getLogs'].includes(body.method));
    return Response.json({ jsonrpc: '2.0', id: body.id, result: body.method === 'eth_chainId' ? '0x2105' : body.method === 'eth_blockNumber' ? '0x1000' : [] });
  });
  const object = env.PAID_GATEWAY.objects.get(`seller-gateway-v1:payout:${operation_hash}`);
  await object.alarm(); await object.alarm(); assert.equal(settles, 1);
  const state = await sellerCall(env, '/seller/payout-status', {}, `payout:${operation_hash}`);
  assert.equal(state.payout_status, 'awaiting_chain_evidence'); assert.equal(state.payout_transaction, null);
});

test('Seller payout requires exact chain transfer evidence and records proceeds only once', async t => {
  const env = environment(), account = privateKeyToAccount(`0x${'2'.repeat(64)}`), operation_hash = 'b'.repeat(64);
  env.XGUARD_PAYOUT_PRIVATE_KEY = `0x${'2'.repeat(64)}`; env.XGUARD_TREASURY_USDC_ADDRESS = account.address;
  await sellerCall(env, '/seller/commerce', { operation_hash, request_id: 'xgr_fixture_payout', seller_id: 'fixture', service_id: 'fixture', payout_destination: payer, traffic_class: 'SYNTHETIC', transaction, network: 'eip155:8453', status: 'succeeded', gross_atomic: '100000', platform_fee_atomic: '3000', seller_proceeds_atomic: '97000', proof: 'fixture-delivery-evidence', receipt_signature: 'fixture-receipt' });
  let auth, settles = 0, exact = false;
  t.mock.method(globalThis, 'fetch', async (input, init) => {
    const url = new URL(input instanceof Request ? input.url : input), body = JSON.parse(init.body);
    if (url.pathname === '/verify') { auth = body.paymentPayload.payload.authorization; return Response.json({ isValid: true, payer: account.address }); }
    if (url.pathname === '/settle') { settles++; return Response.json({ success: true, payer: account.address, transaction, network: 'eip155:8453' }); }
    let result;
    if (body.method === 'eth_chainId') result = '0x2105';
    else {
      assert.equal(body.method, 'eth_getTransactionReceipt');
      const used = parseAbiItem('event AuthorizationUsed(address indexed authorizer, bytes32 indexed nonce)'), transfer = parseAbiItem('event Transfer(address indexed from, address indexed to, uint256 value)');
      const asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
      result = { transactionHash: transaction, blockHash: `0x${'a'.repeat(64)}`, blockNumber: '0x1000', transactionIndex: '0x0', status: '0x1', type: '0x2', gasUsed: '0x100', cumulativeGasUsed: '0x100', effectiveGasPrice: '0x1', logs: [
        { address: asset, data: '0x', topics: encodeEventTopics({ abi: [used], args: { authorizer: account.address, nonce: auth.nonce } }) },
        { address: asset, data: encodeAbiParameters([{ type: 'uint256' }], [exact ? 97000n : 96000n]), topics: encodeEventTopics({ abi: [transfer], args: { from: account.address, to: payer } }) },
      ] };
    }
    return Response.json({ jsonrpc: '2.0', id: body.id, result });
  });
  const object = env.PAID_GATEWAY.objects.get(`seller-gateway-v1:payout:${operation_hash}`);
  await object.alarm();
  assert.equal((await sellerCall(env, '/seller/summary')).classes.SYNTHETIC.seller_payout_atomic, '0');
  exact = true; await object.alarm(); await object.alarm();
  assert.equal(settles, 1);
  const summary = await sellerCall(env, '/seller/summary'); assert.equal(summary.classes.SYNTHETIC.seller_payout_atomic, '97000'); assert.equal(summary.classes.REAL.seller_payout_atomic, '0');
});

test('Write idempotency binds authorization and body; changing either never causes a second charge', async t => {
  const env = environment(), calls = network(t); const seller = await onboard(env); const path = new URL(seller.service.endpoint).pathname;
  const init = { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': 'fixture-write-1' }, body: '{"job":"one"}' };
  assert.equal((await request(env, path, { method: 'POST' })).status, 400);
  const q = await challenge(env, seller.service.endpoint, init);
  const paid = { ...init, headers: { ...init.headers, ...paidHeaders(q) } };
  assert.equal((await request(env, path, { ...paid, body: '{"job":"other"}' })).status, 400);
  assert.equal((await request(env, path, paid)).status, 200);
  const q2 = await challenge(env, seller.service.endpoint, init);
  const second = await request(env, path, { ...init, headers: { ...init.headers, ...paidHeaders(q2, { nonce: '4' }) } });
  assert.equal(second.status, 409); assert.equal(calls.settle, 1); assert.equal(calls.upstream, 1);
});

test('Uncertain upstream delivery earn no fee and cannot replay a write', async t => {
  const env = environment(), calls = network(t, { failExecution: true }); const seller = await onboard(env);
  const q = await challenge(env, seller.service.endpoint), headers = paidHeaders(q), path = new URL(seller.service.endpoint).pathname;
  const failed = await request(env, path, { headers }); assert.equal(failed.status, 502);
  assert.equal((await failed.json()).error.details.new_payment_required, false);
  assert.equal((await request(env, path, { headers })).status, 502);
  assert.equal(calls.settle, 1); assert.equal(calls.upstream, 1);
  const revenue = await sellerCall(env, '/seller/summary'); assert.equal(revenue.classes.SYNTHETIC.gross_atomic, '100000'); assert.equal(revenue.classes.SYNTHETIC.platform_fee_atomic, '0'); assert.equal(revenue.classes.SYNTHETIC.seller_credit_atomic, '0');
});

test('Seller origin and path policy reject private destinations, encoded traversal and query credentials', () => {
  for (const target of ['https://127.0.0.1/', 'https://169.254.169.254/', 'https://api.xguardgate.com/', 'https://example.com/?key=secret', 'https://user:pass@example.com/']) assert.throws(() => safeSellerBase(target));
  for (const path of ['/../private', '/%252e%252e/private', '//other.com/', '/a%2fb', '/a\\b']) assert.throws(() => safeSellerPath(path));
});

test('Upstream secret is injected only after payment and reflection is rejected without earning fees', async t => {
  const env = environment(), secret = 'fixture-credential-987', calls = network(t, { secret }); const seller = await onboard(env, { upstream_auth: { header: 'authorization', prefix: 'Bearer ', secret } });
  const q = await challenge(env, seller.service.endpoint); assert.equal(calls.upstream, 0);
  const response = await request(env, new URL(seller.service.endpoint).pathname, { headers: paidHeaders(q) });
  assert.equal(response.status, 502); assert.ok(!(await response.text()).includes(secret));
  assert.equal(new Headers(calls.outgoing.headers).get('authorization'), `Bearer ${secret}`);
  assert.equal(new Headers(calls.outgoing.headers).get('payment-signature'), null);
  const revenue = await sellerCall(env, '/seller/summary'); assert.equal(revenue.classes.SYNTHETIC.platform_fee_atomic, '0');
});
