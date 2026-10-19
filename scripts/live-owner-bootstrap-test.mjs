import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPairSync, privateDecrypt, constants } from 'node:crypto';
import { bootstrapOwner } from './live-owner-bootstrap.mjs';

const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const now = Date.parse('2026-10-07T16:00:00.000Z');
const request = { id: 'test-owner', expires_at: new Date(now + 3600000).toISOString(), public_key: publicKey.export({ type: 'spki', format: 'pem' }) };
function fixture({ secrets = [] } = {}) {
  const calls = [], output = [];
  return {
    calls, output,
    options: {
      request, now, token: 'test-deployment-token-never-live', accountId: 'a'.repeat(32), emit: text => output.push(text),
      fetcher: async (url, options) => {
        calls.push({ url, options });
        if (url === 'https://xguardgate.com/identity') return Response.json({ name: 'XGuard Live', version: '6.0.0', canonical: 'https://xguardgate.com' });
        assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/${'a'.repeat(32)}/workers/scripts/xguard-mainnet/secrets`);
        assert.equal(options.redirect, 'error');
        return Response.json({ success: true, result: options.method === 'PUT' ? { name: 'LIVE_ADMIN_KEY' } : secrets });
      }
    }
  };
}

test('only the private recipient can recover the newly provisioned owner key', async () => {
  const f = fixture();
  const result = await bootstrapOwner(f.options);
  assert.equal(result.status, 'created');
  assert.equal(f.calls.length, 3);
  assert.equal(f.output.length, 1);
  assert.ok(!f.output[0].includes(result.key));
  const ciphertext = Buffer.from(f.output[0].split('=')[1], 'base64');
  const payload = JSON.parse(privateDecrypt({ key: privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ciphertext));
  assert.equal(payload.key, result.key);
  assert.equal(payload.origin, 'https://xguardgate.com');
  assert.equal(payload.id, request.id);
  const write = JSON.parse(f.calls[2].options.body);
  assert.deepEqual(write, { name: 'LIVE_ADMIN_KEY', type: 'secret_text', text: payload.key });
  assert.equal(Buffer.from(payload.key, 'base64url').length, 32);
  const other = generateKeyPairSync('rsa', { modulusLength: 3072 });
  assert.throws(() => privateDecrypt({ key: other.privateKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, ciphertext));
});

test('existing operator credential is preserved without any secret write', async () => {
  const f = fixture({ secrets: [{ name: 'XGUARD_OPERATOR_KEY' }] });
  assert.deepEqual(await bootstrapOwner(f.options), { status: 'existing-credential-preserved' });
  assert.equal(f.calls.length, 2); assert.equal(f.output.length, 0);
});

test('an existing but unusable owner key cannot be overwritten by bootstrap', async () => {
  const f = fixture({ secrets: [{ name: 'LIVE_ADMIN_KEY' }] });
  assert.deepEqual(await bootstrapOwner(f.options), { status: 'existing-credential-preserved' });
  assert.equal(f.calls.length, 2); assert.equal(f.output.length, 0);
});

test('unknown identity or unavailable secret inventory cannot create credentials', async () => {
  const f = fixture();
  for (const result of [{ name: 'Other service' }, { success: false }]) {
    const fetcher = async (url, options) => url.endsWith('/identity') && result.name === 'Other service' ? Response.json(result)
      : url.endsWith('/secrets') ? Response.json(result) : f.options.fetcher(url, options);
    await assert.rejects(bootstrapOwner({ ...f.options, fetcher }), /Unexpected production service|Secret inventory unavailable/);
  }
  assert.equal(f.output.length, 0);
});

test('expired requests do nothing and long-lived or private recipients fail closed', async () => {
  const f = fixture();
  assert.deepEqual(await bootstrapOwner({ ...f.options, now: now + 3600001 }), { status: 'expired' });
  await assert.rejects(bootstrapOwner({ ...f.options, request: { ...request, expires_at: new Date(now + 86400001).toISOString() } }), /within one day/);
  await assert.rejects(bootstrapOwner({ ...f.options, request: { ...request, public_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) } }), /only a public key/);
  assert.equal(f.calls.length, 0);
});
