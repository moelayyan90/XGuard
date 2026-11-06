import { randomBytes, createCipheriv, publicEncrypt, constants } from 'node:crypto';
const publicKey = "-----BEGIN PUBLIC KEY-----\nMIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAn+Tt0G3sOl4bz2LHKjjX\nC5pCkBnxJnGDxmNCJe+TYzqUm8tluq0MCsyfHSviIDNLbD/09qcIqGHG+gdVVYhS\n5J9Ffo9MyxmUw4VLfRQH/TPu8jyW0Ps0FxgKxvAyVLAjL9JXAJWaq4inyhpNqeU2\nPbPlUtc8ChswsA2+uVrpLH2tlTHMA0PjigSzvCrYEcWHc+ugAnfoLLQs5J98JBTa\nJjz9g/Z5SMY7RUc/TFPpWFBmQpH9ujV3B3REiydI2E20d+MKhw1EkTkU5Z/P93+5\nulvkmhT/PDLLV+ZgxV/sxNl4TStfoAuBCxOHa1Hm7fhI6s4l7OQpBX9I+U1WkJVp\njQIDAQAB\n-----END PUBLIC KEY-----\n";
const owner = process.env.LIVE_ADMIN_KEY || '';
let result;
if (owner.length < 24) result = { available: false, reason: 'owner_key_unavailable' };
else {
  try {
    const r = await fetch('https://xguardgate.com/admin/paid-revenue', { headers: { authorization: 'Bearer ' + owner, accept: 'application/json', 'user-agent': 'XGuardLivePrivateAudit/1.0' }, redirect: 'error', signal: AbortSignal.timeout(20000) });
    if (!r.ok) { await r.body?.cancel(); result = { available: false, status: r.status }; }
    else {
      const text = await r.text();
      if (text.length > 262144) throw new Error('bounded_result_exceeded');
      const data = JSON.parse(text);
      result = { available: true, checked_at: new Date().toISOString(), paid_revenue: data };
    }
  } catch { result = { available: false, reason: 'private_summary_unavailable' }; }
}
const key = randomBytes(32), iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', key, iv);
const encrypted = Buffer.concat([cipher.update(JSON.stringify(result), 'utf8'), cipher.final()]);
const wrapped = publicEncrypt({ key: publicKey, padding: constants.RSA_PKCS1_OAEP_PADDING, oaepHash: 'sha256' }, key);
console.log('PRIVATE_REVENUE_AUDIT:' + JSON.stringify({ wrapped_key: wrapped.toString('base64'), iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), ciphertext: encrypted.toString('base64') }));
