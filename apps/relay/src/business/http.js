import { boundedJson, fail } from '../compute/common.js';
import { actionCatalog, actionProduct } from '../action/catalog.js';
import { checkoutReadiness } from '../action/gateway.js';
import { paypalConfig } from '../action/paypal.js';
import { paymentProviders } from '../payments/orchestrator/providers.js';
import { businessCatalog } from './catalog.js';
import { approvedPartners, distributionChannels } from './distribution.js';
import { commerceSaleEnabled } from '../products/registry.js';

const prefix = '/v1/commerce';
const origins = ['https://xguardgate.com', 'https://api.xguardgate.com'];
const escape = value => String(value).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function html(products, product) {
  const shown = product ? [product] : products;
  const cards = shown.map(p => `<article class="task-card"><span class="index">${escape(p.section)} / ${p.adapters.length ? 'BOUNDED ADAPTERS' : 'NOT AVAILABLE FOR PURCHASE'}</span><h2>${escape(p.name)}</h2><p>${escape(p.scope)}</p>${p.adapters.map(a => `<p><strong>${escape(a.name)}</strong><br>Agent price: ${(Number(a.amount_atomic) / 1000000).toFixed(6)} USDC · Human checkout: $${(a.card_amount_cents / 100).toFixed(2)} USD<br><a href="${escape(a.checkout_url)}">Review scope & checkout ↗</a>${a.agent_endpoint ? ` · <a href="${escape(a.agent_endpoint)}">Agent contract</a>` : ''}</p>`).join('')}<p class="fine">${escape(p.implementation_scope)}</p><details><summary>Full product dependencies</summary><ul>${p.dependencies.map(d => `<li>${escape(d)}</li>`).join('')}</ul></details>${product ? '' : `<p><a href="/products/${escape(p.id)}">Product scope & availability →</a></p>`}</article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${product ? escape(product.name) : 'Paid execution & commercial products'} | XGuard</title><meta name="description" content="XGuard bounded paid execution, verifiable data and transparent commercial product availability."><link rel="canonical" href="https://xguardgate.com/products${product ? '/' + escape(product.id) : ''}"><link rel="stylesheet" href="/assets/action-v1.css"></head><body><header><a class="brand" href="/">XGuard</a><nav aria-label="Main navigation"><a href="/marketplace">Buy a task</a><a href="/products">Products</a><a href="/action/docs">API</a><a href="/dashboard">My tasks</a></nav></header><main class="section"><div class="eyebrow">XGUARD / PAID EXECUTION</div><h1>${product ? escape(product.name) : 'Defined work.<br>Verifiable delivery.'}</h1><p class="lead">Select an implemented task, inspect its inputs and price, and use the shared checkout or existing x402 payment flow. Review the final price at checkout to see the available PayPal and eligible card options.</p><p><a href="/v1/commerce/catalog">Machine-readable scope & dependencies</a> · <a href="/v1/commerce/providers">Payment availability</a> · <a href="/v1/commerce/partners">Approved partners</a></p><div class="task-grid">${cards}</div></main><footer><a href="/identity">Operator & contact</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a><a href="/refund-policy">Refunds</a></footer></body></html>`;
}
function response(request, env, value, status = 200, type = 'application/json; charset=utf-8') {
  const origin = request.headers.get('origin');
  const headers = { 'content-type': type, 'cache-control': 'private, no-store', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-xguard-worker-version-id': env.CF_VERSION_METADATA?.id || '', 'x-xguard-worker-version-tag': env.CF_VERSION_METADATA?.tag || '' };
  if (origin && origins.includes(origin)) Object.assign(headers, { 'access-control-allow-origin': origin, vary: 'Origin', 'access-control-allow-methods': 'GET, HEAD, POST, OPTIONS', 'access-control-allow-headers': 'Content-Type' });
  if (!type.startsWith('text/html')) headers['x-robots-tag'] = 'noindex';
  else headers['content-security-policy'] = "default-src 'none'; style-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'";
  return new Response(request.method === 'HEAD' || status === 204 ? null : typeof value === 'string' ? value : JSON.stringify(value), { status, headers });
}
export async function commerceFetch(request, env) {
  const url = new URL(request.url), path = url.pathname;
  if (!(path === prefix || path.startsWith(prefix + '/') || path === '/products' || path.startsWith('/products/'))) return null;
  if (!['xguardgate.com', 'api.xguardgate.com', 'localhost', '127.0.0.1'].includes(url.hostname)) return null;
  try {
    if (request.headers.get('origin') && !origins.includes(request.headers.get('origin'))) throw fail('origin_not_allowed', 403);
    if (request.method === 'OPTIONS') return response(request, env, null, 204);
    const products = businessCatalog(actionCatalog(), paypalConfig(env).ready);
    if (path.startsWith('/products') && ['GET', 'HEAD'].includes(request.method)) {
      const id = path.slice('/products/'.length), product = products.find(p => p.id === id);
      if (path !== '/products' && !product) throw fail('product_not_found', 404);
      return response(request, env, html(products, product), 200, 'text/html; charset=utf-8');
    }
    if (['GET', 'HEAD'].includes(request.method)) {
      if (path === prefix + '/catalog') return response(request, env, { name: 'XGuard paid execution & commerce', products, new_service_purchase_enabled: commerceSaleEnabled(env), payment_providers: prefix + '/providers', discovery: distributionChannels, inventory_and_demand: 'No exclusive inventory, contracted partners, independent customer demand or earned commissions inferred from technical availability.', strategies: [{ id: 'reverse-auction', status: 'Not Implemented', implemented: 'Bounded supplied-offer comparison', dependencies: ['Verified suppliers', 'Negotiation authority', 'Order execution adapter'] }, { id: 'revenue-agents', status: 'Implemented, Pending External Activation', implemented: 'Deterministic API/MCP task adapters with paid delivery', dependencies: ['Commercial buyer distribution and outcome contracts'] }, { id: 'grants', status: 'Awaiting Provider Approval', implemented: 'Evidence and integration documentation', dependencies: ['Program eligibility', 'Submitted and accepted application; no grant amount recognized'] }] });
      if (path === prefix + '/providers') return response(request, env, paymentProviders(env));
      if (path === prefix + '/partners' || path === prefix + '/offers/search') {
        const q = (url.searchParams.get('q') || '').trim().toLowerCase(), capability = url.searchParams.get('capability');
        if (q.length > 150 || (capability && !/^[a-z0-9-]{1,80}$/.test(capability))) throw fail('invalid_supplier_query', 422);
        const partners = approvedPartners(env).filter(p => (!q || (p.name + ' ' + p.capabilities.join(' ')).toLowerCase().includes(q)) && (!capability || p.capabilities.includes(capability))).sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
        return response(request, env, { partners, count: partners.length, status: partners.length ? 'Operator-configured agreements; live prices and conversions not yet connected' : 'Awaiting Commercial Partnership', ranking: 'Name and stable ID, never commission rate', price_and_capacity_verified: false, commission_earned: null });
      }
    }
    if (request.method === 'POST' && path === prefix + '/offers/compare') {
      const body = await boundedJson(request, 4000);
      if (!body || Object.keys(body).some(k => k !== 'partner_ids') || !Array.isArray(body.partner_ids) || body.partner_ids.length < 1 || body.partner_ids.length > 10 || new Set(body.partner_ids).size !== body.partner_ids.length || body.partner_ids.some(id => typeof id !== 'string' || !/^[a-z0-9-]{1,80}$/.test(id))) throw fail('invalid_partner_comparison', 422);
      const partners = approvedPartners(env), selected = body.partner_ids.map(id => partners.find(p => p.id === id));
      if (selected.some(p => !p)) throw fail('approved_partner_not_found', 404);
      return response(request, env, { partners: selected, ranking: 'Requested order; no hidden sponsored ranking', total_prices: null, orders_placed: 0 });
    }
    if (request.method === 'POST' && path === prefix + '/purchase') {
      const body = await boundedJson(request, 1000);
      if (!body || Object.keys(body).some(k => k !== 'service') || typeof body.service !== 'string') throw fail('invalid_product_purchase', 422);
      const product = actionProduct(body.service);
      if (!product) throw fail('product_unavailable', 503);
      const readiness = await checkoutReadiness(env);
      return response(request, env, { service: product.id, amount_cents: product.card_amount_cents, currency: 'USD', checkout_url: 'https://xguardgate.com' + product.checkout_url, card_ready: readiness.ready, blockers: readiness.blockers, agent_endpoint: product.legacy_x402_url ? 'https://api.xguardgate.com' + product.legacy_x402_url : null, charged: false, requires_explicit_buyer_payment: true });
    }
    return response(request, env, { error: 'commerce_route_not_found' }, 404);
  } catch (e) { return response(request, env, { error: e.code || 'commerce_dependency_unavailable', ...(e.details || {}) }, e.status || 503); }
}
