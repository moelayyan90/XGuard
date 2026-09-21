import { hostnameAllowed } from './network-policy.js';

export const SELLER_API = 'https://api.xguardgate.com';
export const SELLER_NETWORK = 'eip155:8453';
export const SELLER_ASSET = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913';
export const SELLER_MAX_REQUEST_BYTES = 16384;
export const SELLER_MAX_RESPONSE_BYTES = 49152;
export const SELLER_TRAFFIC_CLASSES = ['REAL', 'SYNTHETIC', 'INTERNAL', 'CRAWLER', 'REGISTRY', 'MONITORING'];
export const SELLER_FUNNEL = ['discovered_service', 'service_requested', 'quote_created', 'payment_required', 'payment_submitted', 'payment_verified', 'payment_settled', 'upstream_execution_started', 'upstream_execution_succeeded', 'receipt_returned', 'xguard_fee_earned'];
const METHODS = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']);
export class SellerError extends Error {
  constructor(code, status = 400) { super(code); this.code = code; this.status = status; }
}
export function sellerInteger(value, name, min = 0, max = 999999999) {
  if (!/^(0|[1-9][0-9]*)$/.test(String(value ?? '')) || !Number.isSafeInteger(Number(value)) || Number(value) < min || Number(value) > max) throw new SellerError(`invalid_${name}`);
  return Number(value);
}
export function sellerAddress(value) {
  if (typeof value !== 'string' || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) throw new SellerError('invalid_payout_destination');
  return value.toLowerCase();
}
export function sellerFeePolicy(env, sellerId) {
  let overrides;
  try { overrides = JSON.parse(env.XGUARD_SELLER_FEE_OVERRIDES || '{}'); } catch { throw new SellerError('fee_configuration_invalid', 503); }
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) throw new SellerError('fee_configuration_invalid', 503);
  const override = Object.hasOwn(overrides, sellerId) ? overrides[sellerId] : {};
  if (!override || typeof override !== 'object' || Array.isArray(override)) throw new SellerError('fee_configuration_invalid', 503);
  return {
    bps: sellerInteger(override.bps ?? env.XGUARD_PLATFORM_FEE_BPS ?? '300', 'fee_bps', 0, 10000),
    fixed_atomic: sellerInteger(override.fixed_atomic ?? env.XGUARD_FIXED_FEE_ATOMIC ?? '0', 'fixed_fee'),
    minimum_atomic: sellerInteger(override.minimum_atomic ?? env.XGUARD_MINIMUM_FEE ?? '0', 'minimum_fee'),
    rounding: 'ceil_to_atomic_unit',
  };
}
export function splitSellerPrice(price, policy) {
  const gross = BigInt(sellerInteger(price, 'price_atomic', 1));
  const bps = BigInt(sellerInteger(policy.bps, 'fee_bps', 0, 10000));
  const fixed = BigInt(sellerInteger(policy.fixed_atomic, 'fixed_fee'));
  const minimum = BigInt(sellerInteger(policy.minimum_atomic, 'minimum_fee'));
  const percentagePlusFixed = (gross * bps + 9999n) / 10000n + fixed;
  const fee = percentagePlusFixed > minimum ? percentagePlusFixed : minimum;
  if (fee >= gross) throw new SellerError('price_does_not_cover_fee');
  return { gross_atomic: gross.toString(), platform_fee_atomic: fee.toString(), seller_proceeds_atomic: (gross - fee).toString(), policy: { ...policy } };
}
export function safeSellerPath(value) {
  if (typeof value !== 'string' || value.length > 2048 || !value.startsWith('/') || /[\\\u0000-\u0020\u007f?#]/u.test(value) || value.startsWith('//')) throw new SellerError('invalid_service_path');
  let decoded = value;
  for (let i = 0; i < 4; i++) {
    if (/%(?:2e|2f|5c|00)/i.test(decoded) || /(?:^|\/)\.{1,2}(?:\/|$)/.test(decoded) || decoded.includes('\\')) throw new SellerError('path_escape_blocked', 403);
    let next; try { next = decodeURIComponent(decoded); } catch { throw new SellerError('invalid_service_path'); }
    if (next === decoded) return value;
    decoded = next;
  }
  throw new SellerError('path_escape_blocked', 403);
}
export function safeSellerBase(value) {
  let url; try { url = new URL(value); } catch { throw new SellerError('invalid_upstream_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || (url.port && url.port !== '443') || !hostnameAllowed(url.hostname)) throw new SellerError('upstream_not_public_https');
  safeSellerPath(url.pathname);
  return url.href;
}
function text(value, field, max) {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/u.test(value)) throw new SellerError(`invalid_${field}`);
  return value.trim();
}
export function normalizeSellerService(raw, seller, env) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new SellerError('invalid_service');
  const methods = raw.allowed_methods ?? ['GET'];
  if (!Array.isArray(methods) || !methods.length || methods.length > 6 || methods.some(m => !METHODS.has(m))) throw new SellerError('invalid_allowed_methods');
  const price = String(sellerInteger(raw.price_atomic, 'price_atomic', 1));
  const policy = sellerFeePolicy(env, seller.seller_id);
  splitSellerPrice(price, policy);
  const routePricing = raw.route_pricing ?? [];
  if (!Array.isArray(routePricing) || routePricing.length > 20) throw new SellerError('invalid_route_pricing');
  const routes = routePricing.map(route => {
    if (!route || !methods.includes(route.method)) throw new SellerError('invalid_route_method');
    const path = safeSellerPath(route.path);
    const routePrice = String(sellerInteger(route.price_atomic, 'route_price', 1));
    splitSellerPrice(routePrice, policy);
    return { method: route.method, path, price_atomic: routePrice };
  });
  if (new Set(routes.map(r => `${r.method} ${r.path}`)).size !== routes.length) throw new SellerError('duplicate_route_price');
  let schema = raw.input_schema ?? { type: 'object', description: 'The seller API accepts its original request format.' };
  if (!schema || typeof schema !== 'object' || Array.isArray(schema) || JSON.stringify(schema).length > 4096) throw new SellerError('invalid_input_schema');
  const injection = raw.upstream_auth;
  if (injection && (!['authorization', 'x-api-key', 'api-key', 'x-auth-token'].includes(injection.header?.toLowerCase()) || typeof injection.secret !== 'string' || injection.secret.length < 8 || injection.secret.length > 4096 || /[\r\n\u0000]/.test(injection.secret) || !['', 'Bearer ', 'Basic '].includes(injection.prefix ?? ''))) throw new SellerError('invalid_upstream_auth');
  return { seller_id: seller.seller_id, service_id: `svc_${crypto.randomUUID().replaceAll('-', '')}`, service_name: text(raw.service_name, 'service_name', 100), description: text(raw.description ?? raw.service_name, 'description', 400), upstream_base_url: safeSellerBase(raw.upstream_base_url), allowed_methods: [...new Set(methods)], price_atomic: price, route_pricing: routes, currency: 'USDC', asset: SELLER_ASSET, network: SELLER_NETWORK, platform_fee: policy, payout_destination: sellerAddress(raw.payout_destination), max_requests_per_minute: sellerInteger(raw.max_requests_per_minute ?? 60, 'request_limit', 1, 300), input_schema: schema, revision: 1, status: 'draft', created_at: new Date().toISOString(), upstream_auth: injection ? { header: injection.header.toLowerCase(), prefix: injection.prefix ?? '' } : null };
}
export function sellerRequestPrice(service, method, path) {
  if (!service.allowed_methods.includes(method)) throw new SellerError('service_method_not_allowed', 405);
  safeSellerPath(path);
  return service.route_pricing.find(r => r.method === method && r.path === path)?.price_atomic ?? service.price_atomic;
}
export function sellerTraffic(request, payer = '', service = null, env = {}) {
  const declared = String(request?.headers?.get('x-xguard-traffic-class') ?? '').toLowerCase();
  if (['internal', 'self_test', 'demo', 'canary', 'testnet'].includes(declared)) return 'INTERNAL';
  if (declared === 'synthetic') return 'SYNTHETIC';
  if (declared === 'registry') return 'REGISTRY';
  if (declared === 'monitoring') return 'MONITORING';
  const agent = String(request?.headers?.get('user-agent') ?? '').toLowerCase();
  if (/registry|glama|smithery|mcpcentral|agent.?card/.test(agent)) return 'REGISTRY';
  if (/uptime|healthcheck|monitor|pingdom|statuscake/.test(agent)) return 'MONITORING';
  if (/crawler|spider|bot\b|scanner|security/.test(agent)) return 'CRAWLER';
  const internal = String(env.XGUARD_INTERNAL_WALLETS || '').toLowerCase().split(',').map(x => x.trim());
  if (payer && [env.XGUARD_TREASURY_USDC_ADDRESS, service?.payout_destination, ...internal].filter(Boolean).some(x => String(x).toLowerCase() === payer.toLowerCase())) return 'INTERNAL';
  return 'REAL';
}
