// Explicitly no payment wallet or payment signature. Existing license balance
// is read to admit one sandbox tenant; no credit is consumed by this example.
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createIdentity, organizationForLicense, signCommand, sendCommand } from './client.mjs';
import { verifyReceiptOffline } from './verify-receipt.mjs';
import { keyId } from '../../apps/relay/src/financial-authority/crypto.js';

const license = process.env.XGUARD_LICENSE;
if (!license) throw Error('Set XGUARD_LICENSE to your existing funded XGuard license; never paste it into a prompt, URL or issue.');
const directory = join(homedir(), '.xguard', 'authority');
const filename = join(directory, 'sandbox-owner.json');
await mkdir(directory, { recursive: true, mode: 0o700 });
let owner;
try {
  const info = await stat(filename); if (info.mode & 0o077) throw Error('Owner authentication file must have permissions 0600');
  const saved = JSON.parse(await readFile(filename, 'utf8'));
  owner = { publicKey: saved.public_key, privateKey: await crypto.subtle.importKey('jwk', saved.private_key, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']), id: await keyId(saved.public_key) };
} catch (error) {
  if (error.code !== 'ENOENT') throw error;
  owner = await createIdentity();
  await writeFile(filename, JSON.stringify({ public_key: owner.publicKey, private_key: await crypto.subtle.exportKey('jwk', owner.privateKey) }) + '\n', { flag: 'wx', mode: 0o600 });
}
const org = await organizationForLicense(license), parent = await createIdentity(), leaf = await createIdentity();
const policy = { currency: 'USD', asset: 'synthetic_no_funds', network: 'simulation:local', payees: ['synthetic_merchant_no_funds'], per_operation: '10', per_period: '1000', lifetime: '100000', period_seconds: 86400 };
let organizationToken;
async function send(who, action, payload) {
  const envelope = await signCommand(who, org, action, payload);
  const result = await sendCommand(envelope, action === 'enroll' ? { enrollmentToken: license } : { organizationToken });
  if (result.status !== 200) throw Error('Authority ' + action + ' failed: ' + (result.body.error || result.status));
  return result.body;
}
organizationToken = (await send(owner, 'enroll', { owner_key: owner.publicKey, policies: [policy], accept_price_atomic: '50000' })).result.organization_token;
const suffix = crypto.randomUUID().replaceAll('-', ''), rootGrant = 'demo_parent_' + suffix, leafGrant = 'demo_leaf_' + suffix;
const notBefore = Date.now() - 1000, expires = Date.now() + 240000;
await send(owner, 'grant', { grant_id: rootGrant, parent: null, agent_key: parent.publicKey, policy, not_before: notBefore, expires_at: expires, depth_remaining: 1 });
await send(parent, 'grant', { grant_id: leafGrant, parent: rootGrant, agent_key: leaf.publicKey, policy, not_before: notBefore, expires_at: expires, depth_remaining: 0 });
const operationId = 'demo_operation_' + suffix;
await send(leaf, 'authorize', { operation_id: operationId, grant_id: leafGrant, currency: policy.currency, asset: policy.asset, network: policy.network, payee: policy.payees[0], principal_atomic: '10', provider_fee_cap_atomic: '0', max_service_fee_atomic: '50000', adapter: 'sandbox-simulation', task_digest: 'A'.repeat(43), expires_at: Date.now() + 120000 });
const done = await send(leaf, 'execute', { operation_id: operationId });
const proofResponse = await fetch('https://api.xguardgate.com/v1/authority/proof-key', { redirect: 'error', signal: AbortSignal.timeout(10000) });
if (!proofResponse.ok) throw Error('Proof key unavailable');
const proof = await proofResponse.json(), verified = verifyReceiptOffline(done.receipt.jws, proof.jwk);
if (!verified.valid || done.result.mode !== 'sandbox' || done.result.settlement?.payload?.external_effect !== false) throw Error('Sandbox receipt validation failed');
await send(owner, 'revoke', { grant_id: rootGrant });
console.log(JSON.stringify({ organization_id: org, operation_id: operationId, state: done.result.state, receipt_verified: true, real_transfers: 0, service_fee_collected: '0', commercial_revenue: false, receipt: done.receipt, public_key: proof.jwk, trust: 'Pin the expected production public key through a trusted channel before relying on verification.' }, null, 2));
