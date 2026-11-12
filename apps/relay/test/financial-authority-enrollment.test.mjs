import { test } from 'node:test';
import assert from 'node:assert/strict';
import { authorizeEnrollment, organizationForLicense } from '../src/financial-authority/enrollment.js';
import { createIdentity, signCommand } from '../../../sdk/financial-authority/client.mjs';

const key = 'xgk_fixture_existing_paid_license_123456789';
const env = { LIVE_ADMIN_KEY: 'fixture_operator_key_only_for_tests_123456' };
const owner = await createIdentity(), org = await organizationForLicense(key);
const envelope = await signCommand(owner, org, 'enroll', { owner_key: owner.publicKey });
const request = (credential = key) => new Request('https://api.xguardgate.com/v1/authority/enroll', { headers: { authorization: 'Bearer ' + credential } });
const funded = { credits: 10, granted: 20, consumed: 10, refunded_credits: 0, debt_credits: 0, restricted: false };

test('funded license enrollment checks a pinned read-only endpoint without debit or key persistence', async t => {
  const original = globalThis.fetch; let calls = 0, reply = () => Response.json(funded);
  globalThis.fetch = async (url, init) => {
    calls++; assert.equal(url, 'https://hooks.xguardgate.com/v1/balance');
    assert.equal(init.method, 'GET'); assert.equal(init.redirect, 'manual'); assert.equal(init.body, undefined);
    assert.equal(init.headers.authorization, 'Bearer ' + key); return reply();
  };
  t.after(() => { globalThis.fetch = original; });
  await t.test('one deterministic tenant per license', async () => {
    assert.match(org, /^org_[A-Za-z0-9_-]{43}$/); assert.equal(await organizationForLicense(key), org);
    assert.notEqual(await organizationForLicense(key + 'other'), org);
    const before = structuredClone(envelope); await authorizeEnrollment(request(), env, envelope); assert.deepEqual(envelope, before); assert.equal(calls, 1);
  });
  await t.test('operator enrollment retains compatibility without a billing call', async () => {
    const n = calls; await authorizeEnrollment(request(env.LIVE_ADMIN_KEY), env, envelope); assert.equal(calls, n);
  });
  await t.test('invalid tenant and signature fail before any provider lookup', async () => {
    const n = calls;
    await assert.rejects(authorizeEnrollment(request(), env, { ...envelope, org_id: 'other_organization' }), { code: 'license_organization_mismatch' });
    await assert.rejects(authorizeEnrollment(request(), env, { ...envelope, signature: 'A'.repeat(86) }), { code: 'invalid_agent_signature' });
    assert.equal(calls, n);
  });
  for (const [name, changed, code] of [
    ['restricted', { restricted: true }, 'funded_unrestricted_license_required'],
    ['debt', { debt_credits: 1 }, 'funded_unrestricted_license_required'],
    ['empty', { credits: 0 }, 'funded_unrestricted_license_required'],
    ['fully refunded', { refunded_credits: 20 }, 'funded_unrestricted_license_required'],
    ['string credit', { credits: '10' }, 'enrollment_billing_response_invalid'],
    ['unsafe integer', { credits: 2 ** 54 }, 'enrollment_billing_response_invalid'],
    ['missing restriction', { restricted: undefined }, 'enrollment_billing_response_invalid'],
  ]) await t.test(name + ' is rejected', async () => {
    reply = () => Response.json({ ...funded, ...changed });
    await assert.rejects(authorizeEnrollment(request(), env, envelope), { code });
  });
  for (const status of [301, 401, 404, 429, 503]) await t.test('provider HTTP ' + status + ' fails closed', async () => {
    reply = () => new Response('{}', { status, headers: { location: 'https://untrusted.test/' } });
    await assert.rejects(authorizeEnrollment(request(), env, envelope), { status: [401,404].includes(status) ? 403 : 503 });
  });
  await t.test('invalid JSON and unreachable provider fail closed', async () => {
    reply = () => new Response('not JSON');
    await assert.rejects(authorizeEnrollment(request(), env, envelope), { code: 'enrollment_billing_unavailable' });
    reply = () => { throw Error('provider_down'); };
    await assert.rejects(authorizeEnrollment(request(), env, envelope), { code: 'enrollment_billing_unavailable' });
  });
});
