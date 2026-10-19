import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import { x402Client } from '@x402/core/client';
import { ExactEvmScheme } from '@x402/evm/exact/client';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { verifyTypedData } from 'viem';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createLivePaidClient, verifyLiveDelivery } from '../../../sdk/live-paid.js';
import { shardName, shardOf } from '../src/live/util.ts';

// All financial provider calls are intercepted. The transient signer is never
// funded or printed. A simulated settlement is not a production transaction.
const bundle = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
let settlements = 0, verified = 0, sourceCalls = 0;
const types = { TransferWithAuthorization: [{ name: 'from', type: 'address' }, { name: 'to', type: 'address' }, { name: 'value', type: 'uint256' }, { name: 'validAfter', type: 'uint256' }, { name: 'validBefore', type: 'uint256' }, { name: 'nonce', type: 'bytes32' }] };
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ name: 'live-paid-test', modules: true, modulesRoot: resolve(bundle, '..'), scriptPath: bundle, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: Object.fromEntries(['LiveShard', 'LiveControl', 'ProofAuthority', 'PaidGatewayState'].map(className => [{ LiveShard: 'LIVE_SHARDS', LiveControl: 'LIVE_CONTROL', ProofAuthority: 'PROOF_AUTHORITY', PaidGatewayState: 'PAID_GATEWAY' }[className], { className, useSQLite: true }])),
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'on', LIVE_PAID_SERVICES: 'on', XGUARD_PAYMENT_ENVIRONMENT: 'production', XGUARD_PAID_FACILITATOR: 'https://facilitator.test', XGUARD_TREASURY_USDC_ADDRESS: '0x4f32f8fe1ee3e9f5c5a6587dc019a13bb453ba07', XGUARD_PAYMENT_COST_BUDGET_USD_MICROS: '0', XGUARD_MIN_CONTRIBUTION_BPS: '2000', XGUARD_INFRASTRUCTURE_COST_BUDGET_USD_MICROS: '100' },
  outboundService: async request => {
    const url = new URL(request.url);
    if (url.hostname === 'facilitator.test') {
      if (url.pathname === '/supported') return MFResponse.json({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }] });
      const body = await request.json(), payment = body.paymentPayload, requirements = body.paymentRequirements;
      const auth = payment.payload.authorization;
      if (url.pathname === '/verify') {
        const valid = await verifyTypedData({ address: auth.from, domain: { name: 'USD Coin', version: '2', chainId: 8453, verifyingContract: requirements.asset }, types, primaryType: 'TransferWithAuthorization', message: { ...auth, value: BigInt(auth.value), validAfter: BigInt(auth.validAfter), validBefore: BigInt(auth.validBefore) }, signature: payment.payload.signature });
        assert.equal(valid, true); verified++; return MFResponse.json({ isValid: valid, payer: auth.from });
      }
      assert.equal(url.pathname, '/settle'); assert.ok(verified > 0); settlements++;
      return MFResponse.json({ success: true, network: 'eip155:8453', transaction: `0x${'2'.repeat(64)}`, payer: auth.from });
    }
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) return MFResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (url.hostname === 'registry.npmjs.org' && url.pathname === '/robots.txt') return new MFResponse('', { status: 404 });
    if (url.hostname === 'registry.npmjs.org' && url.pathname === '/react/latest') { sourceCalls++; return MFResponse.json({ name: 'react', version: '1.2.3', license: 'MIT' }); }
    throw new Error('Unexpected outbound destination: real providers are prohibited in this fixture');
  },
}] }));
try {
  await mf.ready;
  const namespace = await mf.getDurableObjectNamespace('LIVE_SHARDS'), stub = namespace.get(namespace.idFromName(shardName(shardOf('npm/react'))));
  const rpc = (op, body = {}) => stub.fetch('https://internal/rpc', { method: 'POST', body: JSON.stringify({ ...body, op }) }).then(r => r.json());
  await rpc('seed', { sources: [{ adapter: 'npm', identifier: 'react' }] });
  for (let i = 0; i < 80; i++) { if ((await rpc('fact', { id: 'npm/react/latest-version' }))?.current_value === '1.2.3') break; await new Promise(r => setTimeout(r, 250)); }
  assert.equal((await rpc('fact', { id: 'npm/react/latest-version' })).current_value, '1.2.3');
  const readiness = await mf.dispatchFetch('https://api.xguardgate.com/api/paid/v1/readiness'); assert.equal(readiness.status, 200, await readiness.clone().text());
  let recovery;
  const payer = new x402Client().register('eip155:8453', new ExactEvmScheme(privateKeyToAccount(generatePrivateKey())));
  const client = createLivePaidClient({ payer, maxAmountAtomic: '10000', trafficClass: 'synthetic', fetchImpl: (url, init) => mf.dispatchFetch(url, init), onPaymentPrepared: value => { recovery = value; } });
  const result = await client.request('batch', { facts: ['npm/react/latest-version'] }); assert.equal(result.status, 200, await result.clone().text());
  const delivered = await result.json(); assert.equal(delivered.result.rows[0].fact.current_value, '1.2.3'); assert.equal(settlements, 1); assert.equal(sourceCalls, 1, 'Paid reads must not trigger additional external collection');
  const key = await (await mf.dispatchFetch('https://api.xguardgate.com/api/paid/v1/proof-key')).json(); assert.equal(await verifyLiveDelivery(delivered, key.jwk), true);
  const recovered = await client.recover(recovery); assert.equal(recovered.status, 200); assert.equal(settlements, 1);
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/fact/npm/react/latest-version', { headers: { accept: 'application/json' } })).status, 200);
  console.log(JSON.stringify({ workerd: 'passed', official_x402_client: true, cryptographic_authorization_verified: true, simulated_settlements: settlements, new_source_calls_from_paid_request: 0, recovery_without_second_settlement: true, production_money_moved: false }));
} finally { await mf.dispose(); }
