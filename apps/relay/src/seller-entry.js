import { gatewayConfig, handlePaidWebFetch, rateLimit, recoverOutcome } from './paid-agent-entry.js';
import { digestBytes, readBoundedBody, credentialVariants } from './core/execution-contract.js';
import { SELLER_API, SELLER_ASSET, SELLER_NETWORK, SELLER_MAX_REQUEST_BYTES, SellerError, normalizeSellerService, sellerFeePolicy, sellerRequestPrice, sellerTraffic, splitSellerPrice, safeSellerPath } from './core/seller-policy.js';
import { sellerPayoutConfiguration } from './core/seller-payout.js';
import { sellerCall, protectSellerSecret } from './seller-commerce.js';
import { normalizeOutcome } from './outcome-catalog.js';
import { decodePaymentSignatureHeader } from '@x402/core/http';

const encode = value => new TextEncoder().encode(value);
const hash = value => digestBytes(encode(value));
const headers = { 'content-type': 'application/json', 'cache-control': 'no-store', 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS', 'access-control-allow-headers': 'Content-Type,Authorization,Payment-Signature,X-XGuard-Quote,Idempotency-Key,X-XGuard-Traffic-Class', 'access-control-expose-headers': 'Payment-Required,Payment-Response,X-XGuard-Quote,X-XGuard-Receipt,X-XGuard-Proof,X-XGuard-Payment-Identifier,X-XGuard-Platform-Fee-Atomic,X-XGuard-Seller-Proceeds-Atomic' };
const json = (body, status = 200) => Response.json(body, { status, headers });
function b64(bytes) { let value = ''; for (const b of bytes) value += String.fromCharCode(b); return btoa(value); }
async function readJson(request) {
  const bytes = await readBoundedBody(request.body, SELLER_MAX_REQUEST_BYTES);
  try { const v = JSON.parse(new TextDecoder().decode(bytes)); if (!v || typeof v !== 'object' || Array.isArray(v)) throw 0; return v; }
  catch { throw new SellerError('invalid_json'); }
}
async function sellerIdentity(request, env) {
  const token = request.headers.get('authorization')?.match(/^Bearer (xgs_[a-f0-9]{64})$/)?.[1];
  if (!token) throw new SellerError('seller_authentication_required', 401);
  return (await sellerCall(env, '/seller/auth', { key_hash: await hash(token) })).seller;
}
function readiness(service, env) {
  const amounts = [service.price_atomic, ...service.route_pricing.map(x => x.price_atomic)];
  for (const amount of amounts) {
    const split = splitSellerPrice(amount, service.platform_fee);
    const payout = sellerPayoutConfiguration(env, service.payout_destination, split.seller_proceeds_atomic);
    if (!payout.ready) return payout;
    const config = gatewayConfig(env, false, { capability: 'seller-service', marketplace: { split, payout_destination: service.payout_destination, resource: SELLER_API } });
    if (!config.configured) return { ready: false, reason: config.configurationError || 'payment_not_configured' };
  }
  return { ready: true, mode: sellerPayoutConfiguration(env, service.payout_destination).mode };
}
export function publicSellerService(service, env) {
  const ready = readiness(service, env);
  const endpoint = `${SELLER_API}/p/${service.seller_id}/${service.service_id}/`;
  return { seller: service.seller_id, service_id: service.service_id, name: service.service_name, description: service.description, price: { amount_atomic: service.price_atomic, currency: 'USDC', decimals: 6 }, route_pricing: service.route_pricing, platform_fee: service.platform_fee, allocation: splitSellerPrice(service.price_atomic, service.platform_fee), payout_destination: service.payout_destination, payout_mode: ready.mode || null, endpoint, allowed_methods: service.allowed_methods, input_schema: service.input_schema, capabilities: ['paid-http-api', 'signed-receipt', 'idempotent-payment'], availability: service.status === 'active' && ready.ready ? 'available' : 'unavailable', status: service.status, unavailable_reason: ready.ready ? null : ready.reason, max_requests_per_minute: service.max_requests_per_minute, created_at: service.created_at, authentication: 'x402-v2; no buyer account', curl: `curl -i '${endpoint}'`, discovery: `${SELLER_API}/v1/marketplace/services` };
}
export function ownedSellerService(env) {
  return { seller_id: 'xguard', service_id: 'feed-digest', service_name: 'Deduplicated feed digest', description: 'Merge the Hacker News and GitHub Changelog feeds into one deduplicated stream with source links and coverage.', price_atomic: String(env.XGUARD_MARKETPLACE_DEMO_PRICE_ATOMIC || '100000'), route_pricing: [], platform_fee: sellerFeePolicy(env, 'xguard'), payout_destination: env.XGUARD_TREASURY_USDC_ADDRESS, allowed_methods: ['GET'], network: SELLER_NETWORK, asset: SELLER_ASSET, max_requests_per_minute: 30, input_schema: { type: 'object', properties: { limit: { type: 'integer', minimum: 1, maximum: 30, default: 10 } } }, revision: 1, status: 'active', created_at: null };
}
async function serviceFor(env, seller, serviceId) {
  const service = seller === 'xguard' && serviceId === 'feed-digest' ? ownedSellerService(env) : (await sellerCall(env, '/seller/service-get', { service_id: serviceId })).service;
  if (service.seller_id !== seller) throw new SellerError('service_not_found', 404);
  return service;
}
async function event(env, request, id, service, name, reason, paymentFailure = false) {
  let payer = '';
  try { payer = decodePaymentSignatureHeader(request.headers.get('payment-signature'))?.payload?.authorization?.from || ''; } catch { /* A missing proof cannot establish a payer. */ }
  await sellerCall(env, '/seller/event', { request_id: id, service_id: service?.service_id, traffic_class: sellerTraffic(request, payer, service, env), event: name, reason, payment_failure: paymentFailure }).catch(() => {});
}
export async function handleSellerRoute(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!(path.startsWith('/p/') || path.startsWith('/v1/sellers') || path.startsWith('/v1/marketplace/') || path === '/internal/revenue-funnel')) return null;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
  const id = `xgr_${crypto.randomUUID().replaceAll('-', '')}`;
  let service;
  try {
    if (!env.PAID_GATEWAY || !env.PROOF_AUTHORITY) throw new SellerError('seller_gateway_unavailable', 503);
    const resultMatch = path.match(/^\/v1\/marketplace\/results\/(pay_[A-Za-z0-9_-]+)$/);
    if (resultMatch && request.method === 'GET') return recoverOutcome(env, resultMatch[1], request.headers.get('x-xguard-quote') || '', id);
    if (path === '/internal/revenue-funnel') {
      if (request.method !== 'GET') throw new SellerError('method_not_allowed', 405);
      const supplied = request.headers.get('authorization')?.replace(/^Bearer /, '');
      if (!env.XGUARD_OPERATOR_METRICS_KEY || !supplied || await hash(supplied) !== await hash(env.XGUARD_OPERATOR_METRICS_KEY)) throw new SellerError('operator_authentication_required', 401);
      const revenue = await sellerCall(env, '/seller/summary'); const real = revenue.classes.REAL;
      const ratio = (n, d) => d ? n / d : null;
      return json({ ...revenue, metrics: { REAL_PAID_TRANSACTIONS: real.paid_transactions, REAL_GROSS_VOLUME: real.gross_atomic, XGUARD_REVENUE: real.platform_fee_atomic, SELLER_PAYOUTS: real.seller_payout_atomic, FAILED_PAYMENT_ATTEMPTS: real.failed_payment_attempts, PAYMENT_TO_EXECUTION_CONVERSION: ratio(real.paid_transactions, real.funnel.payment_submitted), DISCOVERY_TO_PAYMENT_CONVERSION: ratio(real.paid_transactions, real.funnel.discovered_service) }, units: 'USDC atomic units (1 USDC = 1000000); conversions are request-event ratios, not unique customer ratios', basis: 'Unique verified production settlements; fees recognized only after signed delivery. Same-owner retention is separate from on-chain seller payouts. Historical activity before this ledger is not backfilled.' });
    }
    if (path === '/v1/marketplace/services' && request.method === 'GET') {
      const data = await sellerCall(env, '/seller/catalog');
      const query = (url.searchParams.get('q') || '').toLowerCase().slice(0, 120);
      const services = [ownedSellerService(env), ...data.services.filter(x => x.status === 'active')].map(x => publicSellerService(x, env)).filter(x => x.availability === 'available' && (!query || `${x.name} ${x.description}`.toLowerCase().includes(query)));
      await event(env, request, id, null, 'discovered_service');
      return json({ services, currency: 'USDC', network: SELLER_NETWORK, buyer_account_required: false, seller_onboarding: 'https://xguardgate.com/sellers' });
    }
    if (path === '/v1/sellers' && request.method === 'POST') {
      if (!(await rateLimit(request, env, 'seller-registration', 3)).allowed) throw new SellerError('rate_limited', 429);
      const raw = await readJson(request);
      if (typeof raw.name !== 'string' || !raw.name.trim() || raw.name.length > 100 || /[\u0000-\u001f]/.test(raw.name)) throw new SellerError('invalid_seller_name');
      const token = `xgs_${crypto.randomUUID().replaceAll('-', '')}${crypto.randomUUID().replaceAll('-', '')}`;
      const seller_id = `sel_${crypto.randomUUID().replaceAll('-', '')}`;
      await sellerCall(env, '/seller/register', { seller_id, name: raw.name.trim(), key_hash: await hash(token) });
      return json({ seller_id, token, token_shown_once: true, next: `${SELLER_API}/v1/sellers/services` }, 201);
    }
    if (path.startsWith('/v1/sellers')) {
      const seller = await sellerIdentity(request, env);
      if (!(await rateLimit(request, env, `seller-control:${seller.seller_id}`, 60)).allowed) throw new SellerError('rate_limited', 429);
      if (path === '/v1/sellers/services' && request.method === 'POST') {
        const raw = await readJson(request); service = normalizeSellerService(raw, seller, env);
        if (raw.upstream_auth) {
          if (credentialVariants(raw.upstream_auth.secret).some(x => JSON.stringify(service).includes(x))) throw new SellerError('secret_in_service_metadata');
          service.secret_envelope = await protectSellerSecret(env, raw.upstream_auth.secret);
        }
        const ready = readiness(service, env); service.status = ready.ready ? 'active' : 'draft';
        await sellerCall(env, '/seller/service-create', { service });
        return json({ service: publicSellerService(service, env), activation: ready }, 201);
      }
      if (path === '/v1/sellers/services' && request.method === 'GET') return json({ services: (await sellerCall(env, '/seller/catalog', { seller_id: seller.seller_id })).services.map(s => publicSellerService(s, env)) });
      if (path === '/v1/sellers/dashboard' && request.method === 'GET') {
        const data = await sellerCall(env, '/seller/summary', { seller_id: seller.seller_id });
        for (const sale of data.transactions) if (sale.status === 'succeeded') Object.assign(sale, await sellerCall(env, '/seller/payout-status', {}, `payout:${sale.operation_hash}`));
        return json({ seller, ...data, currency: 'USDC', decimals: 6 });
      }
      const match = path.match(/^\/v1\/sellers\/services\/(svc_[a-f0-9]{32})\/status$/);
      if (match && request.method === 'POST') {
        service = await serviceFor(env, seller.seller_id, match[1]); const raw = await readJson(request);
        if (raw.status === 'active' && !readiness(service, env).ready) throw new SellerError(readiness(service, env).reason, 503);
        return json(await sellerCall(env, '/seller/service-status', { seller_id: seller.seller_id, service_id: service.service_id, status: raw.status }));
      }
      throw new SellerError('seller_route_not_found', 404);
    }
    const match = path.match(/^\/p\/([a-z0-9_\-]{1,64})\/([a-z0-9_\-]{1,64})(\/.*)?$/);
    if (!match) throw new SellerError('service_not_found', 404);
    service = await serviceFor(env, match[1], match[2]);
    const servicePath = safeSellerPath(match[3] || '/');
    const price = sellerRequestPrice(service, request.method, servicePath);
    if (service.status !== 'active') throw new SellerError('service_not_active', 503);
    const ready = readiness(service, env); if (!ready.ready) throw new SellerError(ready.reason, 503);
    if (!(await rateLimit(request, env, `seller-request:${service.service_id}`, service.max_requests_per_minute)).allowed) throw new SellerError('rate_limited', 429);
    const idempotency = request.headers.get('idempotency-key') || '';
    if (idempotency && !/^[A-Za-z0-9_.:-]{8,128}$/.test(idempotency)) throw new SellerError('invalid_idempotency_key');
    if (!['GET', 'HEAD'].includes(request.method) && !idempotency) throw new SellerError('idempotency_key_required');
    if (url.search.length > 2048) throw new SellerError('query_too_large', 413);
    const bytes = await readBoundedBody(request.body, SELLER_MAX_REQUEST_BYTES);
    const m = { seller_id: service.seller_id, service_id: service.service_id, revision: service.revision, path: servicePath, query: url.search, method: request.method, body_base64: b64(bytes), accept: (request.headers.get('accept') || 'application/json').slice(0, 256), content_type: (request.headers.get('content-type') || '').slice(0, 256), idempotency_key: idempotency, resource: `${SELLER_API}${path}${url.search}`, platform_fee: service.platform_fee, split: splitSellerPrice(price, service.platform_fee), payout_destination: service.payout_destination };
    if (service.seller_id === 'xguard') {
      if (servicePath !== '/' || [...url.searchParams.keys()].some(k => k !== 'limit')) throw new SellerError('unsupported_demo_parameters');
      const parsed = normalizeOutcome({ capability: 'feed-digest', limit: Number(url.searchParams.get('limit') || '10') });
      if (!parsed.ok) throw new SellerError('invalid_demo_limit');
      m.owned_outcome = parsed.input;
    }
    await event(env, request, id, service, 'service_requested');
    if (request.headers.has('payment-signature')) await event(env, request, id, service, 'payment_submitted');
    const response = await handlePaidWebFetch(request, env, id, {}, false, 'seller-http', { capability: 'seller-service', marketplace: m });
    if (response.status === 402 && response.headers.has('payment-required')) {
      if (!request.headers.has('x-xguard-quote') && !request.headers.has('payment-signature')) await event(env, request, id, service, 'quote_created');
      await event(env, request, id, service, 'payment_required');
    }
    if (!response.ok && (response.status !== 402 || request.headers.has('payment-signature'))) {
      const body = await response.clone().json().catch(() => ({}));
      await event(env, request, id, service, 'failure', body.error?.code || body.error || 'paid_request_failed', request.headers.has('payment-signature'));
    }
    return response;
  } catch (cause) {
    const code = cause instanceof SellerError ? cause.code : cause.message === 'response_too_large' ? 'request_too_large' : 'seller_gateway_unavailable';
    await event(env, request, id, service, 'failure', code, request.headers.has('payment-signature'));
    return json({ error: code, request_id: id }, cause instanceof SellerError ? cause.status : cause.message === 'response_too_large' ? 413 : 503);
  }
}
