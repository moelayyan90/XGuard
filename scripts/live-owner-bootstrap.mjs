import { createPublicKey, publicEncrypt, randomBytes, constants } from 'node:crypto';
import { appendFileSync, readFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const ORIGIN = 'https://xguardgate.com';
const WORKER = 'xguard-mainnet';

// Only initializes a missing credential. It never retrieves or rotates a secret.
// The recipient private key stays with the owner, outside git and Actions.
export async function bootstrapOwner({ request, token, accountId, fetcher = fetch, now = Date.now(), emit = console.log, mask = () => {} }) {
  if (!request || !Number.isFinite(Date.parse(request.expires_at))) throw new Error('Invalid bootstrap expiry');
  if (Date.parse(request.expires_at) <= now) return { status: 'expired' };
  if (Date.parse(request.expires_at) - now > 86400000) throw new Error('Bootstrap request must expire within one day');
  if (!/^[a-z0-9-]{1,80}$/.test(request.id || '')) throw new Error('Invalid bootstrap request id');
  if (typeof request.public_key !== 'string' || !request.public_key.startsWith('-----BEGIN PUBLIC KEY-----')) throw new Error('Recipient must contain only a public key');
  const recipient = createPublicKey(request.public_key);
  if (recipient.asymmetricKeyType !== 'rsa' || recipient.asymmetricKeyDetails.modulusLength < 3072) throw new Error('Recipient requires RSA 3072 bits or greater');
  async function requestJson(url, options = {}) {
    const response = await fetcher(url, { ...options, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Bootstrap request failed: HTTP ${response.status}`);
    return response.json();
  }
  const health = await requestJson(`${ORIGIN}/healthz`, { headers: { 'user-agent': 'XGuardLive-owner-bootstrap/6.0', 'cache-control': 'no-cache' } });
  if (health.service !== 'XGuard Live' || health.version !== '6.0.0') throw new Error('Unexpected production service');
  if (health.owner_access === 'configured') return { status: 'already-configured' };
  if (health.owner_access !== 'unconfigured') throw new Error('Owner state is unknown');
  const apiToken = (token || '').replace(/[\r\n]/g, '').trim().replace(/^Bearer\s+/i, '').replace(/^"|"$/g, '').trim();
  if (!/^[a-f0-9]{32}$/i.test(accountId || '') || apiToken.length < 20) throw new Error('Deployment credentials unavailable');
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/scripts/${WORKER}/secrets`;
  const headers = { authorization: `Bearer ${apiToken}`, 'content-type': 'application/json' };
  const existing = await requestJson(endpoint, { headers });
  if (!existing.success || !Array.isArray(existing.result)) throw new Error('Secret inventory unavailable');
  if (existing.result.some(item => item.name === 'LIVE_ADMIN_KEY')) throw new Error('Refusing to overwrite an existing owner credential');
  const key = randomBytes(32).toString('base64url');
  mask(key);
  const payload = JSON.stringify({ id: request.id, origin: ORIGIN, key, created_at: new Date(now).toISOString() });
  const envelope = publicEncrypt({ key: recipient, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, Buffer.from(payload)).toString('base64');
  // Emit recoverable ciphertext before the write in case its response is lost.
  // Plaintext credentials are never an artifact, commit, log, or command argument.
  emit(`XGUARD_LIVE_OWNER_ENVELOPE_V1=${envelope}`);
  const result = await requestJson(endpoint, { method: 'PUT', headers, body: JSON.stringify({ name: 'LIVE_ADMIN_KEY', text: key, type: 'secret_text' }) });
  if (!result.success) throw new Error('Owner secret creation failed');
  return { status: 'created', key };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const path = '.github/live-owner-bootstrap.json';
  if (!existsSync(path)) console.log('No owner bootstrap request; existing credentials preserved.');
  else {
    try {
      const result = await bootstrapOwner({ request: JSON.parse(readFileSync(path, 'utf8')), token: process.env.CLOUDFLARE_API_TOKEN, accountId: process.env.CLOUDFLARE_ACCOUNT_ID, mask: key => console.log(`::add-mask::${key}`) });
      if (result.key && process.env.GITHUB_ENV) appendFileSync(process.env.GITHUB_ENV, `LIVE_BOOTSTRAPPED_ADMIN_KEY=${result.key}\n`, { mode: 0o600 });
      console.log(JSON.stringify({ owner_bootstrap: result.status }));
    } catch {
      console.error('Owner bootstrap failed. Existing credentials are never overwritten; inspect the encrypted envelope and Cloudflare secret status before retrying.');
      process.exitCode = 1;
    }
  }
}
