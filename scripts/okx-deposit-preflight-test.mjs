import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import test from 'node:test';
import { verifyOkxDeposit } from './okx-deposit-preflight.mjs';

const origin = 'https://openapi.okx.com';
const destination = '0x' + 'a'.repeat(40);
const hash = '0x' + 'b'.repeat(64);
const now = () => new Date('2026-11-05T02:40:00.000Z');
const env = { OKX_API_ORIGIN: origin, OKX_API_KEY: 'test-key', OKX_API_SECRET: 'test-secret',
  OKX_API_PASSPHRASE: 'test-passphrase', OKX_APPROVED_DEPOSIT_ADDRESS: destination, OKX_EXPECTED_NET_USDC: '10.00' };
const rail = { ccy: 'USDC', chain: 'USDC-Base', ctAddr: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  canDep: true, needTag: false, minDep: '10.00000000' };
const record = { ccy: 'USDC', chain: 'USDC-Base', txId: hash, to: destination, amt: '10', state: '2' };

function mock({ permissions = 'read_only', asset = rail, address = destination, history = [record] } = {}) {
  const seen = [];
  const fetchImpl = async (input, init) => {
    const url = new URL(input), requestPath = url.pathname + url.search;
    assert.equal(url.origin, origin);
    assert.equal(init.method, 'GET');
    assert.equal(init.redirect, 'error');
    assert.equal(init.headers['OK-ACCESS-SIGN'],
      createHmac('sha256', env.OKX_API_SECRET).update(now().toISOString() + 'GET' + requestPath).digest('base64'));
    seen.push(url.pathname);
    const data = {
      '/api/v5/account/config': [{ perm: permissions }],
      '/api/v5/asset/currencies': [asset],
      '/api/v5/asset/deposit-address': [{ ccy: 'USDC', chain: 'USDC-Base', addr: address }],
      '/api/v5/asset/deposit-history': history,
    }[url.pathname];
    assert.ok(data, 'only fixed, read-only endpoints may be called');
    return Response.json({ code: '0', data });
  };
  return { fetchImpl, now, seen };
}

test('matches the pinned recipient, USDC contract and exact deposit minimum', async () => {
  const result = await verifyOkxDeposit(env, mock());
  assert.equal(result.verified, true);
  assert.equal(result.depositStatus, 'not_checked');
  assert.equal(result.transfersSubmitted, 0);
});
test('rejects keys with write permissions before accessing the funding account', async () => {
  const deps = mock({ permissions: 'read_only,withdraw' });
  await assert.rejects(verifyOkxDeposit(env, deps), /read_only_okx_key_required/);
  assert.deepEqual(deps.seen, ['/api/v5/account/config']);
});
test('rejects an unexpected domain before any authenticated request', async () => {
  const deps = mock();
  await assert.rejects(verifyOkxDeposit({ ...env, OKX_API_ORIGIN: 'https://openapi.okx.com.evil.test' }, deps), /invalid_okx_api_origin/);
  assert.deepEqual(deps.seen, []);
});
test('rejects closed deposits, a different contract, a different recipient and insufficient amount', async () => {
  await assert.rejects(verifyOkxDeposit(env, mock({ asset: { ...rail, canDep: false } })), /deposit_unavailable/);
  await assert.rejects(verifyOkxDeposit(env, mock({ asset: { ...rail, ctAddr: destination } })), /contract_mismatch/);
  await assert.rejects(verifyOkxDeposit(env, mock({ address: '0x' + '1'.repeat(40) })), /destination_mismatch/);
  await assert.rejects(verifyOkxDeposit({ ...env, OKX_EXPECTED_NET_USDC: '9.999999' }, mock()), /below_okx_deposit_minimum/);
});
test('requires exact existing transaction match and successful OKX status', async () => {
  const reconcileEnv = { ...env, OKX_EXISTING_TX_HASH: hash };
  assert.equal((await verifyOkxDeposit(reconcileEnv, mock())).depositStatus, 'confirmed');
  assert.equal((await verifyOkxDeposit(reconcileEnv, mock({ history: [] }))).depositStatus, 'not_found');
  assert.equal((await verifyOkxDeposit(reconcileEnv, mock({ history: [{ ...record, state: '1' }] }))).depositStatus, 'credited_not_final');
  await assert.rejects(verifyOkxDeposit(reconcileEnv, mock({ history: [{ ...record, amt: '11' }] })), /deposit_record_mismatch/);
  await assert.rejects(verifyOkxDeposit(reconcileEnv, mock({ history: [record, record] })), /deposit_record_mismatch/);
});
