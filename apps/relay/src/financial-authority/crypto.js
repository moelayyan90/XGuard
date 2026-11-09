// The wire format uses sorted JSON objects, integer timestamps and decimal
// strings for money. It is versioned; it does not claim arbitrary RFC 8785 input.
export const AUDIENCE = 'https://api.xguardgate.com/v1/authority';
export const PROTOCOL = 'xguard-afa/1';
export class AuthorityError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function need(value, code, status = 400) { if (!value) throw new AuthorityError(code, status); }
export function canonical(value) {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number') { need(Number.isSafeInteger(value), 'integer_required'); return JSON.stringify(value); }
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  need(value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype, 'invalid_object');
  return '{' + Object.keys(value).sort().map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
}
export const bytes = value => new TextEncoder().encode(typeof value === 'string' ? value : canonical(value));
export const b64 = value => btoa(String.fromCharCode(...new Uint8Array(value))).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
export function unb64(value) {
  need(typeof value === 'string' && /^[A-Za-z0-9_-]+$/.test(value), 'invalid_base64');
  return Uint8Array.from(atob(value.replaceAll('-', '+').replaceAll('_', '/')), x => x.charCodeAt(0));
}
export async function digest(value) { return b64(await crypto.subtle.digest('SHA-256', bytes(value))); }
export function publicKey(jwk) {
  need(jwk?.kty === 'EC' && jwk.crv === 'P-256' && !('d' in jwk) && unb64(jwk.x).length === 32 && unb64(jwk.y).length === 32, 'public_p256_key_required');
  need(b64(unb64(jwk.x)) === jwk.x && b64(unb64(jwk.y)) === jwk.y, 'noncanonical_public_key');
  return { crv: 'P-256', kty: 'EC', x: jwk.x, y: jwk.y };
}
export const keyId = jwk => digest(publicKey(jwk));
export async function verify(value, signature, jwk) {
  try {
    const key = await crypto.subtle.importKey('jwk', publicKey(jwk), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
    const sig = unb64(signature);
    return sig.length === 64 && await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, sig, bytes(value));
  } catch { return false; }
}
export function unsigned(envelope) {
  const { signature, ...value } = envelope;
  return value;
}
export function checkEnvelope(envelope, action, mode, now = Date.now()) {
  need(envelope && typeof envelope === 'object' && !Array.isArray(envelope), 'signed_envelope_required');
  need(Object.keys(envelope).sort().join(',') === 'action,audience,expires_at,issued_at,mode,nonce,org_id,payload,protocol,signature,signer', 'invalid_envelope_fields');
  need(envelope.protocol === PROTOCOL && envelope.audience === AUDIENCE && envelope.mode === mode && envelope.action === action, 'signature_context_mismatch', 401);
  need(/^[A-Za-z0-9_-]{8,80}$/.test(envelope.org_id) && /^[A-Za-z0-9_-]{16,80}$/.test(envelope.nonce), 'invalid_identity_or_nonce');
  need(Number.isSafeInteger(envelope.issued_at) && Number.isSafeInteger(envelope.expires_at) && envelope.issued_at <= now + 30000 && envelope.issued_at >= now - 300000 && envelope.expires_at > now && envelope.expires_at <= envelope.issued_at + 300000, 'signature_expired', 401);
  need(envelope.payload && typeof envelope.payload === 'object' && !Array.isArray(envelope.payload), 'invalid_payload');
}
export function exact(object, required, optional = []) {
  need(object && typeof object === 'object' && !Array.isArray(object) && required.every(k => Object.hasOwn(object, k)) && Object.keys(object).every(k => [...required, ...optional].includes(k)), 'invalid_payload_fields');
}
export function amount(value, positive = true) {
  need(typeof value === 'string' && /^(0|[1-9][0-9]{0,29})$/.test(value) && (!positive || BigInt(value) > 0n), 'invalid_atomic_amount');
  return BigInt(value);
}
