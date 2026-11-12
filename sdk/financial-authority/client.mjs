// Authentication keys stay with the owner/agent. These are not payment keys.
import { b64, bytes, keyId, PROTOCOL, AUDIENCE, unsigned } from '../../apps/relay/src/financial-authority/crypto.js';
export { organizationForLicense } from '../../apps/relay/src/financial-authority/enrollment.js';
export async function createIdentity() {
  const pair = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign','verify']);
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey);
  return { privateKey: pair.privateKey, publicKey, id: await keyId(publicKey) };
}
export async function signCommand(identity, org, action, payload, options = {}) {
  const now = options.now ?? Date.now();
  const envelope = { protocol: PROTOCOL, audience: AUDIENCE, mode: options.mode || 'sandbox', org_id: org, action, signer: identity.id,
    nonce: options.nonce || crypto.randomUUID().replaceAll('-', ''), issued_at: now, expires_at: now + 240000, payload };
  return { ...envelope, signature: b64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, identity.privateKey, bytes(unsigned(envelope)))) };
}
export async function sendCommand(envelope, options = {}) {
  const origin = options.origin || 'https://api.xguardgate.com';
  const url = new URL(origin);
  if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw Error('https_required');
  const headers = { 'content-type': 'application/json' };
  if (options.enrollmentToken) headers.authorization = 'Bearer ' + options.enrollmentToken;
  if (options.organizationToken) headers['x-xguard-organization-token'] = options.organizationToken;
  // Deliberately no automatic retries and no payment signer.
  const response = await fetch(origin + '/v1/authority/' + envelope.action, { method: 'POST', headers, body: JSON.stringify(envelope), redirect: 'error', signal: AbortSignal.timeout(15000) });
  return { status: response.status, body: await response.json() };
}
