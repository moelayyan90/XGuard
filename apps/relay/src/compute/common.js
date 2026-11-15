import { canonicalize, createJWS } from '@x402/extensions/offer-receipt';

export const API = 'https://api.xguardgate.com';
export const NETWORK = 'eip155:8453';
export const ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const KID = 'did:web:api.xguardgate.com#xguard-proofrail';
export { canonicalize };
export const fail = (code, status = 400, details = {}) => Object.assign(new Error(code), { code, status, details });
export const json = (data, status = 200, headers = {}) => Response.json(data, { status, headers });
export const digest = async value => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(typeof value === 'string' ? value : canonicalize(value))))).map(x => x.toString(16).padStart(2, '0')).join('');
export const id = prefix => prefix + crypto.randomUUID().replaceAll('-', '');
export const record = x => x !== null && typeof x === 'object' && !Array.isArray(x);
export function parsed(value, fallback = {}) { try { return typeof value === 'string' ? JSON.parse(value) : value ?? fallback; } catch { return fallback; } }
export function integer(value, fallback, min = 0, max = Number.MAX_SAFE_INTEGER) {
  const result = Number(value ?? fallback);
  if (!Number.isSafeInteger(result) || result < min || result > max) throw fail('invalid_compute_configuration', 503);
  return result;
}
export function ceilRatio(value, numerator, denominator = 10000) {
  const result = (BigInt(value) * BigInt(numerator) + BigInt(denominator) - 1n) / BigInt(denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('price_overflow', 422);
  return Number(result);
}
export function usdMicros(value) {
  const exponential = /^(\d+)(?:\.(\d+))?[eE]([+-]?\d+)$/.exec(String(value));
  if (exponential) {
    const exponent = Number(exponential[3]);
    if (!Number.isSafeInteger(exponent) || Math.abs(exponent) > 50) throw fail('price_overflow', 422);
    const digits = exponential[1] + (exponential[2] || ''), point = exponential[1].length + exponent;
    value = point <= 0 ? '0.' + '0'.repeat(-point) + digits : point >= digits.length ? digits + '0'.repeat(point - digits.length) : digits.slice(0, point) + '.' + digits.slice(point);
  }
  if (!/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(String(value))) throw fail('provider_cost_unavailable', 503);
  const [whole, fraction = ''] = String(value).split('.');
  const result = BigInt(whole) * 1000000n + BigInt((fraction + '000000').slice(0, 6)) + (/[1-9]/.test(fraction.slice(6)) ? 1n : 0n);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw fail('price_overflow', 422);
  return Number(result);
}
export async function boundedJson(response, limit = 196608) {
  if (Number(response.headers.get('content-length') || 0) > limit) throw fail('payload_too_large', 413);
  const reader = response.body?.getReader();
  if (!reader) throw fail('invalid_json');
  let length = 0;
  const chunks = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > limit) { await reader.cancel(); throw fail('payload_too_large', 413); }
    chunks.push(value);
  }
  const bytes = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  try { return JSON.parse(new TextDecoder().decode(bytes)); } catch { throw fail('invalid_json'); }
}
export function proofStub(env) {
  if (!env.PROOF_AUTHORITY) throw fail('proof_authority_unavailable', 503);
  return env.PROOF_AUTHORITY.get(env.PROOF_AUTHORITY.idFromName('proofrail-root-v1'));
}
export async function sign(env, payload) {
  return createJWS(payload, { kid: KID, format: 'jws', algorithm: 'ES256', async sign(bytes) {
    const data = btoa(String.fromCharCode(...bytes)).replaceAll('+', '-').replaceAll('/', '_').replaceAll('=', '');
    const r = await proofStub(env).fetch('https://proofrail/sign-bytes', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ data }) });
    const result = await r.json();
    if (!r.ok || !result.signature) throw fail('signing_unavailable', 503);
    return result.signature;
  } });
}
export async function stateCall(env, action, body = {}, name = 'compute-gateway-v1') {
  if (!env.PAID_GATEWAY) throw fail('compute_storage_unavailable', 503);
  const r = await env.PAID_GATEWAY.get(env.PAID_GATEWAY.idFromName(name)).fetch('https://compute.internal/compute/' + action, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const result = await r.json();
  if (!r.ok) throw fail(result.error || 'compute_state_unavailable', r.status, result.details);
  return result;
}
