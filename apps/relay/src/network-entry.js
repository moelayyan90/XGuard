import { livePaidFetch } from './live-paid-entry.js';
import { OPERATIONS, ROUTE_PAGES } from './network/catalog.ts';
import { networkRpc } from './network/engine.ts';
import { paymentCoverage } from './network/payments.ts';
import { networkHtml, NETWORK_CSS, NETWORK_JS } from './network/site.ts';
import { securityHeaders } from './live/security.ts';
const aliases = { '/v1/routes/resolve': 'route-resolve', '/v1/routes/compare': 'route-compare', '/v1/discover': 'discover', '/v1/discover/platforms': 'platform-discovery', '/v1/crawl': 'crawl', '/v1/facts': 'fact', '/v1/tasks': 'task', '/v1/schedules': 'schedule', '/v1/verify': 'verify' };
export async function networkFetch(request, env, ctx) {
  const url = new URL(request.url), path = url.pathname;
  if (!['xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) return null;
  const alias = aliases[path];
  if (alias) return livePaidFetch(new Request('https://api.xguardgate.com/api/paid/v1/' + alias, request), env, ctx);
  let response;
  const read = ['GET', 'HEAD'].includes(request.method);
  if (path === '/v1/payments/coverage' && read) response = Response.json(paymentCoverage(env));
  else if (['/v1/quote', '/v1/payments/quote'].includes(path) && request.method === 'POST') response = Response.json({ currency: 'USDC', decimals: 6, services: OPERATIONS.map(d=>({ service: d.id, total_atomic: d.amount, xguard_fee_atomic: d.amount, provider_cost_atomic: '0', fx: null, protection: null, credit: null })), quote_type: 'UNSIGNED_PRICE_CATALOG', instructions: 'Submit the exact service input to obtain a signed x402 quote before payment.' });
  else if (path === '/v1/capabilities' && read) response = Response.json({ product: 'XGuard Global AI Route Network', version: '1.0.0', operations: OPERATIONS.map(d=>({ service_id:d.id, name:d.name, description:d.description, endpoint:'https://api.xguardgate.com/api/paid/v1/'+d.route, price_atomic:d.amount, currency:'USDC' })), payment: '/v1/payments/coverage', docs:'/network/docs', execution_scope: 'Bounded public read-only operations. Provider credentials and paid external actions are not connected.' });
  else {
    const match = path.match(/^\/v1\/(?:tasks|schedules)\/(xgtask_[a-f0-9]{32})(?:\/(resume|verify|cancel))?$/);
    if (match) {
      const action = match[2] || 'status';
      if (action === 'status' ? !read : request.method !== 'POST') response = Response.json({ error:'method_not_allowed' }, {status:405});
      else { try { response = Response.json(await networkRpc(env, match[1], action, { token:request.headers.get('authorization')?.match(/^Bearer (.+)$/)?.[1] || '' })); } catch(e) { response = Response.json({error:e.code || 'task_state_unavailable'}, {status:e.status || 503}); } }
    } else if (['/v1/payments', '/v1/payments/routes', '/v1/payouts'].includes(path)) response = Response.json({ error:'approved_provider_connection_required', coverage:'/v1/payments/coverage', supported_machine_payment:'Use the x402 challenge at the selected billable service endpoint.' }, {status:503});
    else if (path === '/assets/network-v1.css' && read) response = new Response(NETWORK_CSS,{headers:{'content-type':'text/css;charset=utf-8'}});
    else if (path === '/assets/network-v1.js' && read) response = new Response(NETWORK_JS,{headers:{'content-type':'text/javascript;charset=utf-8'}});
    else if (['/network','/routes','/network/docs'].includes(path) || path.startsWith('/routes/') && ROUTE_PAGES[path.slice(8)]) {
      response = read ? new Response(networkHtml(path, url.searchParams),{headers:{'content-type':'text/html;charset=utf-8'}}) : Response.json({error:'method_not_allowed'},{status:405});
    } else return null;
  }
  const headers = new Headers({...securityHeaders(), 'cache-control':'no-store', 'access-control-allow-origin':'*'});
  for(const [key,value] of response.headers) headers.set(key,value);
  if(headers.get('content-type')?.includes('text/html')) headers.set('content-security-policy', "default-src 'none'; style-src 'self'; script-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if(env.CF_VERSION_METADATA?.tag)headers.set('x-xguard-worker-version-tag',env.CF_VERSION_METADATA.tag);
  if(env.CF_VERSION_METADATA?.id)headers.set('x-xguard-worker-version-id',env.CF_VERSION_METADATA.id);
  return new Response(request.method==='HEAD'?null:response.body,{status:response.status,headers});
}
