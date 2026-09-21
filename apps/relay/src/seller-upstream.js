import { credentialVariants, digestBytes, readBoundedBody, responseHeaders } from './core/execution-contract.js';
import { publicDns } from './core/network-policy.js';
import { SELLER_MAX_RESPONSE_BYTES, SellerError, safeSellerPath } from './core/seller-policy.js';
import { sellerCall, openSellerSecret } from './seller-commerce.js';

function fromBase64(value) { return Uint8Array.from(atob(value || ''), x => x.charCodeAt(0)); }
function toBase64(bytes) { let s = ''; for (const b of bytes) s += String.fromCharCode(b); return btoa(s); }

export async function executeSellerUpstream(input, env, executeOwnedOutcome) {
  const m = input.marketplace;
  const started = performance.now();
  if (m.owned_outcome) {
    const result = await executeOwnedOutcome(m.owned_outcome);
    const bytes = new TextEncoder().encode(JSON.stringify(result.data));
    return { ...result, final_url: m.resource, data: { body_base64: toBase64(bytes), status: 200, headers: [['content-type', 'application/json']] }, body_sha256: await digestBytes(bytes) };
  }
  const { service } = await sellerCall(env, '/seller/service-get', { service_id: m.service_id });
  if (service.seller_id !== m.seller_id || service.revision !== m.revision || service.status !== 'active' || !service.allowed_methods.includes(m.method)) throw new SellerError('service_no_longer_active', 409);
  safeSellerPath(m.path);
  const base = new URL(service.upstream_base_url);
  const target = m.path === '/' ? new URL(base) : new URL(`${base.href.replace(/\/$/, '')}${m.path}`);
  target.search = m.query;
  if (target.origin !== base.origin || (target.pathname !== base.pathname && !target.pathname.startsWith(`${base.pathname.replace(/\/$/, '')}/`))) throw new SellerError('upstream_path_escape', 403);
  const dns = await publicDns(target.hostname);
  if (!dns.ok) throw new SellerError('upstream_dns_not_public', 403);
  const outgoing = new Headers({ accept: m.accept || 'application/json', 'user-agent': 'XGuard-Paid-API-Gateway/1.0' });
  if (m.content_type) outgoing.set('content-type', m.content_type);
  if (!['GET', 'HEAD'].includes(m.method)) outgoing.set('idempotency-key', m.idempotency_key);
  let secret = '';
  if (service.secret_envelope) {
    secret = await openSellerSecret(env, service.secret_envelope);
    outgoing.set(service.upstream_auth.header, `${service.upstream_auth.prefix}${secret}`);
  }
  // No buyer authorization, payment signature, cookies or arbitrary headers are
  // forwarded. Redirects never carry the seller's credential to another origin.
  const upstream = await fetch(target, { method: m.method, headers: outgoing, body: ['GET', 'HEAD'].includes(m.method) ? undefined : fromBase64(m.body_base64), redirect: 'manual', signal: AbortSignal.timeout(12000) });
  if (upstream.status >= 300 && upstream.status < 400) throw new SellerError('upstream_redirect_blocked', 502);
  const bytes = await readBoundedBody(upstream.body, SELLER_MAX_RESPONSE_BYTES);
  if (secret && credentialVariants(secret).some(value => new TextDecoder().decode(bytes).includes(value))) throw new SellerError('upstream_secret_reflection_blocked', 502);
  const filtered = secret ? responseHeaders(upstream.headers, secret, service.upstream_auth.header) : responseHeaders(upstream.headers, '\u0000never-a-provider-secret\u0000', 'authorization');
  // Seller-controlled HTML/JS must not execute in XGuard's privileged origin.
  filtered.set('content-security-policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  filtered.set('x-content-type-options', 'nosniff');
  if (!/^application\/json(?:;|$)|^text\/(?:plain|csv)(?:;|$)/i.test(filtered.get('content-type') || '')) filtered.set('content-disposition', 'attachment');
  if (!upstream.ok) throw new SellerError('upstream_non_success', 502);
  return { status: upstream.status, ok: true, final_url: m.resource, body_sha256: await digestBytes(bytes), latency_ms: Math.round(performance.now() - started), data: { body_base64: toBase64(bytes), status: upstream.status, headers: [...filtered] }, trust: 'untrusted_seller_content', source: { transport: 'https', dns_public_address_checked: true } };
}

export function sellerDeliveryResponse(record, replay = false) {
  const result = record.result.data;
  const headers = new Headers(result.headers);
  headers.set('x-xguard-accounting-status', record.seller_ledger_status || 'pending');
  for (const [key, value] of Object.entries({ 'cache-control': 'no-store', 'payment-response': record.payment_response, 'x-xguard-payment-identifier': record.payment_identifier, 'x-xguard-receipt': record.receipt?.signature, 'x-xguard-proof': record.proof?.proof, 'x-xguard-replay': String(replay), 'x-xguard-platform-fee-atomic': record.input.marketplace.split.platform_fee_atomic, 'x-xguard-seller-proceeds-atomic': record.input.marketplace.split.seller_proceeds_atomic, 'x-xguard-request-id': record.request_id, 'access-control-allow-origin': '*', 'access-control-expose-headers': 'Payment-Response,X-XGuard-Payment-Identifier,X-XGuard-Receipt,X-XGuard-Proof,X-XGuard-Replay,X-XGuard-Platform-Fee-Atomic,X-XGuard-Seller-Proceeds-Atomic,X-XGuard-Request-Id' })) if (value != null) headers.set(key, value);
  headers.set('content-security-policy', "sandbox; default-src 'none'; frame-ancestors 'none'");
  headers.set('x-content-type-options', 'nosniff');
  return new Response(record.input.marketplace.method === 'HEAD' || [204, 205, 304].includes(result.status) ? null : fromBase64(result.body_base64), { status: result.status, headers });
}
