// Synthetic no-funds lifecycle only. Never creates a wallet, payment signature,
// executor binding, financial key or real transfer. Credentials are not logged.
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createIdentity, signCommand } from '../sdk/financial-authority/client.mjs';
import { verifyReceiptOffline } from '../sdk/financial-authority/verify-receipt.mjs';

const origin = 'https://api.xguardgate.com', base = origin + '/v1/authority';
const headers = { 'content-type': 'application/json', 'user-agent': 'XGuardAuthority-synthetic-smoke/1.0', 'x-xguard-traffic-class': 'synthetic' };
if (process.env.CANDIDATE_WORKER_ID) headers['Cloudflare-Workers-Version-Overrides'] = 'xguard-mainnet=' + process.env.CANDIDATE_WORKER_ID;
async function call(path, options = {}) {
  const response = await fetch(base + path, { ...options, headers: { ...headers, ...options.headers }, redirect: 'error', signal: AbortSignal.timeout(15000) });
  if (process.env.EXPECTED_XGUARD_TAG) assert.equal(response.headers.get('x-xguard-worker-version-tag'), process.env.EXPECTED_XGUARD_TAG, 'Unexpected authority Worker version');
  return { response, body: await response.json() };
}
const catalog = await call('/catalog'); assert.equal(catalog.response.status, 200);
assert.equal(catalog.body.pricing.live_billing, 'not_activated'); assert.equal(catalog.body.pricing.sandbox_charge, '0');
const disabled = await fetch(origin + '/api/paid/v1/authority', { method: 'POST', headers, body: '{}', signal: AbortSignal.timeout(10000), redirect: 'error' });
assert.equal(disabled.status, 503); assert.equal((await disabled.json()).error, 'authority_fee_activation_required');
const enrollmentKey = process.env.LIVE_ADMIN_KEY || process.env.LIVE_BOOTSTRAPPED_ADMIN_KEY;
if (!enrollmentKey || enrollmentKey.length < 24) {
  console.log(JSON.stringify({ authority_public_contract: 'passed', live_fee_gate: 'closed', authenticated_lifecycle: 'not_performed', reason: 'No existing operator credential available to the workflow', real_transfers: 0 }));
} else {
  const owner = await createIdentity(), parent = await createIdentity(), leaf = await createIdentity();
  const org = 'synthetic_release_' + crypto.randomUUID().replaceAll('-', ''); let organizationToken;
  const send = async (who, action, payload) => {
    const signed = await signCommand(who, org, action, payload);
    const result = await call('/' + action, { method: 'POST', headers: action === 'enroll' ? { authorization: 'Bearer ' + enrollmentKey } : { 'x-xguard-organization-token': organizationToken }, body: JSON.stringify(signed) });
    assert.equal(result.response.status, 200, 'Synthetic authority ' + action + ' failed: ' + String(result.body.error || result.response.status));
    return result.body;
  };
  const policy = { currency: 'USD', asset: 'synthetic_no_funds', network: 'simulation:local', payees: ['synthetic_merchant_no_funds'], per_operation: '10', per_period: '10', lifetime: '10', period_seconds: 86400 };
  const enrolled = await send(owner, 'enroll', { owner_key: owner.publicKey, policies: [policy], accept_price_atomic: '50000' });
  organizationToken = enrolled.result.organization_token; assert.ok(organizationToken);
  const notBefore = Date.now() - 1000, expires = Date.now() + 240000;
  await send(owner, 'grant', { grant_id: 'synthetic_parent_grant', parent: null, agent_key: parent.publicKey, policy, not_before: notBefore, expires_at: expires, depth_remaining: 1 });
  await send(parent, 'grant', { grant_id: 'synthetic_leaf_grant', parent: 'synthetic_parent_grant', agent_key: leaf.publicKey, policy, not_before: notBefore, expires_at: expires, depth_remaining: 0 });
  const intent = { operation_id: 'synthetic_operation', grant_id: 'synthetic_leaf_grant', currency: policy.currency, asset: policy.asset, network: policy.network, payee: policy.payees[0], principal_atomic: '10', provider_fee_cap_atomic: '0', max_service_fee_atomic: '50000', adapter: 'sandbox-simulation', task_digest: 'A'.repeat(43), expires_at: Date.now() + 120000 };
  const reserved = await send(leaf, 'authorize', intent); assert.equal(reserved.result.state, 'RESERVED');
  const done = await send(leaf, 'execute', { operation_id: intent.operation_id });
  assert.equal(done.result.mode, 'sandbox'); assert.equal(done.result.state, 'CONFIRMED'); assert.equal(done.result.settlement.payload.external_effect, false);
  assert.equal(done.result.service_fee.collected_usdc_atomic, '0');
  const proof = await call('/proof-key'); assert.equal(proof.response.status, 200);
  assert.equal(verifyReceiptOffline(done.receipt.jws, proof.body.jwk).valid, true);
  const repeated = await send(leaf, 'execute', { operation_id: intent.operation_id }); assert.equal(repeated.result.replay, true);
  const denied = await call('/authorize', { method: 'POST', headers: { 'x-xguard-organization-token': organizationToken }, body: JSON.stringify(await signCommand(leaf, org, 'authorize', { ...intent, operation_id: 'synthetic_exceeds_budget' })) });
  assert.equal(denied.response.status, 403);
  await send(owner, 'revoke', { grant_id: null });
  const metrics = await send(owner, 'metrics', {}); assert.equal(metrics.result.billing.collected_usdc_atomic, '0'); assert.equal(metrics.result.commercial_revenue_proven, false);
  if (process.env.AUTHORITY_PRODUCTION_EVIDENCE_DIR) {
    await mkdir(process.env.AUTHORITY_PRODUCTION_EVIDENCE_DIR, { recursive: true });
    await writeFile(join(process.env.AUTHORITY_PRODUCTION_EVIDENCE_DIR, 'signed-sandbox-operation.json'), JSON.stringify({ generated_at: new Date().toISOString(), worker_tag: process.env.EXPECTED_XGUARD_TAG || null, scope: 'Synthetic sandbox; no funds moved; no commercial revenue.', operation: done, public_key: proof.body.jwk, verified_offline: true }, null, 2) + '\n');
  }
  console.log(JSON.stringify({ generated_at: new Date().toISOString(), worker_tag: process.env.EXPECTED_XGUARD_TAG || null, authority_public_contract: 'passed', authenticated_lifecycle: 'passed', delegated_levels: 2, independently_verified_receipt: true, duplicate_dispatch: 'fenced', over_budget: 'rejected', organization_revoked: true, live_fee_gate: 'closed', real_transfers: 0, commercial_revenue_usd: 0, scope: 'Synthetic sandbox probe only; authentication keys are ephemeral and are not financial keys.' }));
}
