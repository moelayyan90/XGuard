import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import assert from 'node:assert/strict';
import { readFile, writeFile, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createExtractionCheckout, EXTRACT_ENDPOINT } from '../src/live/extract-checkout.js';
import { verifyLiveDelivery } from '../../../sdk/live-paid.js';
import { shardName, shardOf } from '../src/live/util.ts';

const bundle = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
const fixture = bundle.replace('live-entry.js', 'extract-test-entry.js');
let code = await readFile(bundle, 'utf8');
// The support release already understands recovery; only advertisement/routing
// is enabled here. Financial verification and execution remain production code.
assert.equal((code.match(/var LIVE_PAID = \[/g) || []).length, 1);
const listStart = code.indexOf('var LIVE_PAID = ['), listEnd = code.indexOf('];', listStart);
if (!code.slice(listStart, listEnd).includes('EXTRACT_SERVICE')) code = code.replace('var LIVE_PAID = [', 'var LIVE_PAID = [EXTRACT_SERVICE,');
await writeFile(fixture, code);
const treasury = '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07';
const account = privateKeyToAccount(generatePrivateKey()); // Ephemeral, never funded or printed.
const counts = { settle: 0, verify: 0, source: 0, signature: 0 };
const types = { TransferWithAuthorization: ['from:address', 'to:address', 'value:uint256', 'validAfter:uint256', 'validBefore:uint256', 'nonce:bytes32'].map(x => { const [name, type] = x.split(':'); return { name, type }; }) };
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ name: 'extract-test', modules: true, modulesRoot: dirname(fixture), scriptPath: fixture, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: Object.fromEntries(Object.entries({ LiveShard: 'LIVE_SHARDS', LiveControl: 'LIVE_CONTROL', PaidGatewayState: 'PAID_GATEWAY', ProofAuthority: 'PROOF_AUTHORITY' }).map(([className, name]) => [name, { className, useSQLite: true }])),
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'on', LIVE_PAID_SERVICES: 'on', XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_TREASURY_USDC_ADDRESS: treasury, XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0', XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100', XGUARD_MIN_CONTRIBUTION_BPS: '2000' },
  outboundService: async request => {
    const u = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(u.hostname)) return MFResponse.json({ Status: 0, Answer: u.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (u.hostname === 'registry.npmjs.org') return u.pathname === '/robots.txt' ? new MFResponse('', { status: 404 }) : MFResponse.json({ name: 'react', version: '1.2.3' });
    if (u.hostname === 'example.com') {
      assert.ok(counts.settle > 0, 'No buyer-source access before confirmed settlement'); counts.source++;
      if (u.pathname === '/robots.txt') return new MFResponse('', { status: 404 });
      return new MFResponse('<html><head><title>Fixture page</title></head><body><nav>Skip me</nav><main><h1>Hello</h1><p>Useful source content.</p></main></body></html>', { headers: { 'content-type': 'text/html' } });
    }
    assert.equal(u.hostname, 'facilitator.test', 'Real payment and source providers are forbidden in this test');
    if (u.pathname === '/supported') return MFResponse.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
    const b = await request.json(), a = b.paymentPayload.payload.authorization;
    if (u.pathname === '/verify') {
      const valid = await verifyTypedData({ address: a.from, domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: b.paymentRequirements.asset }, types, primaryType: 'TransferWithAuthorization', message: { ...a, value: BigInt(a.value), validAfter: BigInt(a.validAfter), validBefore: BigInt(a.validBefore) }, signature: b.paymentPayload.payload.signature });
      assert.equal(valid, true); counts.verify++; return MFResponse.json({ isValid: valid, payer: a.from });
    }
    assert.equal(u.pathname, '/settle'); counts.settle++;
    return MFResponse.json({ success: true, network: 'eip155:8453', transaction: '0x' + '2'.repeat(64), payer: a.from });
  },
}] }));
try {
  await mf.ready;
  const ns = await mf.getDurableObjectNamespace('LIVE_SHARDS'), stub = ns.get(ns.idFromName(shardName(shardOf('npm/react'))));
  const rpc = (op, body = {}) => stub.fetch('https://internal/rpc', { method: 'POST', body: JSON.stringify({ ...body, op }) }).then(r => r.json());
  await rpc('seed', { sources: [{ adapter: 'npm', identifier: 'react' }] });
  for (let i = 0; i < 80; i++) { if ((await rpc('fact', { id: 'npm/react/latest-version' }))?.current_value === '1.2.3') break; await new Promise(r => setTimeout(r, 250)); }
  const request = (body, headers = {}) => mf.dispatchFetch(EXTRACT_ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': crypto.randomUUID(), ...headers }, body: JSON.stringify(body) });
  for (const body of [{ urls: ['https://127.0.0.1/'], max_amount_atomic: '12000' }, { urls: ['https://example.com/'], max_amount_atomic: '1' }, { urls: ['https://example.com/'], max_amount_atomic: '12000', capability: 'other' }]) assert.equal((await request(body)).status, 400);
  assert.equal(counts.source, 0); assert.equal(counts.settle, 0);
  let saved, loseResponse = true;
  const client = createExtractionCheckout({ recipient: treasury, cap: '12000', save: value => { saved = value; }, fetchImpl: async (url, init) => {
    const response = await mf.dispatchFetch(url, { ...init, headers: { ...init.headers, 'x-xguard-traffic-class': 'synthetic' } });
    if (init.headers['payment-signature'] && loseResponse) { loseResponse = false; assert.equal(response.status, 200, await response.clone().text()); throw new Error('Simulated lost delivery response'); }
    return response;
  } });
  await client.quote(['https://example.com/']); assert.equal(counts.source, 0); assert.equal(counts.settle, 0);
  const provider = { async request({ method, params }) {
    if (method === 'eth_requestAccounts') return [account.address];
    if (method === 'eth_chainId') return '0x2105';
    assert.equal(method, 'eth_signTypedData_v4'); counts.signature++;
    const typed = JSON.parse(params[1]); return account.signTypedData(typed);
  } };
  await assert.rejects(client.authorize(provider), /lost delivery/);
  assert.equal(saved.state, 'prepared'); assert.equal(counts.signature, 1); assert.equal(counts.settle, 1);
  await assert.rejects(client.quote(['https://example.com/next']), /Recover/);
  const before = { ...counts }, delivery = await client.recover();
  assert.equal(delivery.ok, true); assert.equal(delivery.result.documents[0].title, 'Fixture page');
  assert.ok(!delivery.result.documents[0].text.includes('Skip me')); assert.equal(delivery.result.coverage.complete, true);
  assert.deepEqual(counts, before, 'Recovery cannot fetch sources, sign, verify or settle again'); assert.equal(saved, null);
  const key = await (await mf.dispatchFetch('https://api.xguardgate.com/api/paid/v1/proof-key')).json();
  assert.equal(await verifyLiveDelivery(delivery, key.jwk), true);
  const page = await mf.dispatchFetch('https://xguardgate.com/extract', { headers: { accept: 'text/html' } });
  assert.equal(page.status, 200); assert.match(await page.text(), /Get exact price/);
  assert.match(page.headers.get('content-security-policy'), /connect-src 'self' https:\/\/api.xguardgate.com/);
  console.log(JSON.stringify({ extraction_workerd: 'passed', source_access_before_payment: 0, signed_authorizations: counts.signature, simulated_settlements: counts.settle, lost_response_recovered_without_second_payment: true, signed_delivery_verified: true, production_money_moved: false }));
} finally { await mf.dispose(); await rm(fixture, { force: true }); }
