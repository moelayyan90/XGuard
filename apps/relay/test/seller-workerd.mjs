import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { resolve, dirname, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';
import { encodePaymentSignatureHeader } from '@x402/core/http';
// Run after wrangler deploy --dry-run --outdir /tmp/xguard-seller-worker.
// Accept an explicit installed Miniflare module, or find the npm-exec package.
const modulePath = process.env.XGUARD_MINIFLARE_MODULE || process.env.PATH.split(delimiter).map(p => resolve(p, '../miniflare/dist/src/index.js')).find(existsSync);
if (!modulePath) throw Error('Run with npm exec --package=wrangler@4.130.0, or set XGUARD_MINIFLARE_MODULE to the installed Miniflare module.');
const { Miniflare, convertV4MiniflareOptions, Response: MFResponse } = await import(pathToFileURL(modulePath));
const env = { XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_TREASURY_USDC_ADDRESS: '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07', XGUARD_PAID_FACILITATOR: 'https://facilitator.fixture', XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100', XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0', XGUARD_MIN_CONTRIBUTION_BPS: '2000', XGUARD_OPERATOR_METRICS_KEY: 'fixture-only-admin-key' };
const calls = { verify: 0, settle: 0, upstream: 0 }, payer = `0x${'1'.repeat(40)}`, transaction = `0x${'2'.repeat(64)}`;
const opts = { modulesRoot: dirname(resolve(process.env.XGUARD_WORKER_BUNDLE || '/tmp/xguard-seller-worker/canonical-entry.js')), modules: true, scriptPath: process.env.XGUARD_WORKER_BUNDLE || '/tmp/xguard-seller-worker/canonical-entry.js', compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'], bindings: env, durableObjects: Object.fromEntries(['PaidGatewayState', 'ProofAuthority', 'EgressKeyAuthority'].map((className, i) => [['PAID_GATEWAY', 'PROOF_AUTHORITY', 'EGRESS_KEYS'][i], { className, useSQLite: true }])), outboundService: async request => {
  const url = new URL(request.url);
  if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) return MFResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
  if (url.hostname === 'facilitator.fixture') {
    if (url.pathname === '/verify') { calls.verify++; return MFResponse.json({ isValid: true, payer }); }
    if (url.pathname === '/settle') { calls.settle++; return MFResponse.json({ success: true, payer, transaction, network: 'eip155:8453' }); }
  }
  if (url.hostname === 'example.com') { calls.upstream++; assert.equal(calls.settle, 1); assert.equal(request.headers.get('authorization'), 'Bearer fixture-upstream-key'); return MFResponse.json({ useful_result: 'Workerd fixture', body: await request.json() }); }
  throw Error('Unexpected outbound destination in isolated fixture');
} };
const mf = new Miniflare(convertV4MiniflareOptions ? convertV4MiniflareOptions(opts) : opts);
const call = (path, init = {}) => mf.dispatchFetch(`https://api.xguardgate.com${path}`, init);
const post = (path, body, headers = {}) => call(path, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
try {
  const identityResponse = await post('/v1/sellers', { name: 'Isolated workerd fixture' }); assert.equal(identityResponse.status, 201); const identity = await identityResponse.json();
  const created = await post('/v1/sellers/services', { service_name: 'Workerd paid fixture', upstream_base_url: 'https://example.com/data', allowed_methods: ['POST'], price_atomic: '100000', payout_destination: env.XGUARD_TREASURY_USDC_ADDRESS, upstream_auth: { header: 'authorization', prefix: 'Bearer ', secret: 'fixture-upstream-key' } }, { authorization: `Bearer ${identity.token}` });
  assert.equal(created.status, 201, await created.clone().text()); const service = (await created.json()).service; assert.equal(service.status, 'active');
  const path = new URL(service.endpoint).pathname;
  const requestHeaders = { 'content-type': 'application/json', 'idempotency-key': 'workerd-fixture-001', 'x-xguard-traffic-class': 'synthetic' };
  const quoted = await post(path, { task: 'one' }, requestHeaders); assert.equal(quoted.status, 402); const q = await quoted.json(); assert.equal(calls.upstream, 0);
  const payment = { x402Version: 2, resource: q.resource, accepted: q.accepts[0], payload: { signature: `0x${'1'.repeat(130)}`, authorization: { from: payer, to: q.accepts[0].payTo, value: q.accepts[0].amount, validAfter: '0', validBefore: String(Math.floor(Date.now() / 1000) + 300), nonce: `0x${'3'.repeat(64)}` } }, extensions: { 'payment-identifier': { info: { id: q.extensions.xguard.paymentIdentifier } } } };
  const paidHeaders = { ...requestHeaders, 'payment-signature': encodePaymentSignatureHeader(payment), 'x-xguard-quote': quoted.headers.get('x-xguard-quote') };
  const responses = await Promise.all(Array.from({ length: 12 }, () => post(path, { task: 'one' }, paidHeaders)));
  assert.ok(responses.some(r => r.status === 200)); assert.ok(responses.every(r => [200, 409, 503].includes(r.status)), responses.map(r => r.status).join(','));
  const result = await post(path, { task: 'one' }, paidHeaders); assert.equal(result.status, 200); assert.equal(result.headers.get('x-xguard-replay'), 'true');
  assert.equal(result.headers.get('x-xguard-accounting-status'), 'recorded');
  const verify = await post('/v1/proofs/verify', { proof: result.headers.get('x-xguard-proof') }); const proof = await verify.json(); assert.equal(proof.valid, true); assert.equal(proof.payload.seller.platform_fee_atomic, '3000');
  const revenue = await (await call('/internal/revenue-funnel', { headers: { authorization: `Bearer ${env.XGUARD_OPERATOR_METRICS_KEY}` } })).json();
  assert.equal(revenue.metrics.REAL_PAID_TRANSACTIONS, 0); assert.equal(revenue.metrics.XGUARD_REVENUE, '0'); assert.equal(revenue.classes.SYNTHETIC.paid_transactions, 1); assert.equal(revenue.classes.SYNTHETIC.platform_fee_atomic, '3000');
  assert.deepEqual(calls, { verify: 1, settle: 1, upstream: 1 });
  console.log(JSON.stringify({ ok: true, runtime: 'workerd SQLite Durable Objects', concurrent_requests: responses.length, calls, signed_fee_allocation: true, real_revenue_atomic: '0', synthetic_fee_atomic: '3000', production_payment_proven: false }));
} finally { await mf.dispose(); }
