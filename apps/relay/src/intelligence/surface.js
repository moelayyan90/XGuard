import { sourceSpec } from '../live/adapters.ts';
import { canonicalFact } from '../live/paid-data.ts';
import { BASE, routeFor, fits, amountFor, price } from './catalog.js';
import { ROOT, TITLE, MCP, A2A, catalog, card, openApi, toolsList, landing } from './discovery.js';
import { handlePaidWebFetch, livePaidProofKey, recoverOutcome } from '../paid-agent-entry.js';
import { readPublicJson } from '../core/public-contract.js';
import { ownerRevenue } from './revenue.js';
import { adminIdentity } from '../live/security.ts';
import { glamaOwnershipFetch } from '../glama-ownership.js';
import deployment from '../../deployment-state.json' with { type:'json' };

const isRead = r => ['GET','HEAD'].includes(r.method);
const json = (v,s=200) => Response.json(v,{status:s});
const error = (e,s,more={}) => json({error:e,...more},s);
const prefix = ROOT + '/';
const discoveryPaths = new Set(['/api/paid/v1','/api/paid/v1/catalog','/v1/checkout/catalog','/.well-known/xguard-live.json','/identity','/.well-known/xguard-action-cloud.json']);
const isHost = h => ['xguardgate.com','www.xguardgate.com','api.xguardgate.com'].includes(h);
const id = () => 'xgr_' + crypto.randomUUID().replaceAll('-','');
function final(request,res,env) {
  const h = new Headers(res.headers);
  h.set('cache-control','private, no-store'); h.set('cdn-cache-control','no-store'); h.set('cloudflare-cdn-cache-control','no-store');
  h.set('access-control-allow-origin','*'); h.set('access-control-allow-methods','GET, HEAD, POST, OPTIONS');
  h.set('access-control-allow-headers','Content-Type, Accept, Idempotency-Key, Payment-Signature, X-XGuard-Quote, MCP-Protocol-Version, A2A-Version');
  h.set('access-control-expose-headers','Payment-Required, Payment-Response, X-XGuard-Quote, X-XGuard-Payment-Identifier, Idempotency-Key, X-XGuard-Worker-Version-Tag, X-XGuard-Intelligence-Writer');
  h.set('x-content-type-options','nosniff'); h.set('referrer-policy','no-referrer');
  if (env.CF_VERSION_METADATA?.tag) h.set('x-xguard-worker-version-tag',env.CF_VERSION_METADATA.tag);
  if (env.CF_VERSION_METADATA?.id) h.set('x-xguard-worker-version-id',env.CF_VERSION_METADATA.id);
  return new Response(request.method === 'HEAD' ? null : res.body,{status:res.status,headers:h});
}
async function read(request) {
  if (!/^application\/(?:json|a2a\+json)(?:;|$)/i.test(request.headers.get('content-type') || '')) throw Object.assign(new Error('json_required'),{status:415});
  const r = await readPublicJson(request,24000);
  if (!('value' in r)) throw Object.assign(new Error(r.error),{status:r.error === 'payload_too_large' ? 413 : 400});
  return r.value;
}
async function purchase(req,env,def,query,transport,providedKey) {
  const { max_amount_atomic: cap, ...body } = query && typeof query === 'object' && !Array.isArray(query) ? query : {};
  if (!fits(def.schema,body)) return error('invalid_operation_input',400,{input_schema:def.schema});
  const sig = req.headers.has('payment-signature');
  const supplied = req.headers.get('idempotency-key') ?? providedKey;
  if ((supplied !== undefined && !/^[A-Za-z0-9_-]{8,128}$/.test(supplied)) || (sig && !supplied)) return error('idempotency_key_required',400);
  const key = supplied || crypto.randomUUID();
  const input = {capability:def.id,query:body,idempotency_key:key};
  if (cap !== undefined && (typeof cap !== 'string' || !/^\d{1,12}$/.test(cap) || BigInt(cap) < BigInt(amountFor(input)))) return error('buyer_budget_too_small',400);
  if (req.method === 'HEAD' && sig) return error('use_get_or_post_to_receive_result',405);
  if (sig && deployment.payment_state_write_version < 7) return error('new_payments_pending_reader_rollout',503,{new_charge:false});
  if (req.headers.has('x-xguard-credit')) return error('use_original_receipt_recovery',400);
  const headers = new Headers(req.headers); headers.set('idempotency-key',key);
  const financialRequest = new Request(BASE+'/'+def.route,{method:'POST',headers});
  const result = await handlePaidWebFetch(financialRequest,env,id(),{},false,transport,input);
  const responseHeaders = new Headers(result.headers); responseHeaders.set('idempotency-key',key);
  responseHeaders.set('x-xguard-intelligence-writer',deployment.payment_state_write_version >= 7 ? 'enabled' : 'pending');
  const invalidAuthorization = sig && result.status === 400 && ['payment_payload_invalid','quote_invalid','quote_required','quote_expired'].includes((await result.clone().json()).error_code);
  return new Response(result.body,{status:invalidAuthorization ? 402 : result.status,headers:responseHeaders});
}
const rpcError = (id,code,message,status=400,data) => json({jsonrpc:'2.0',id:id??null,error:{code,message,...(data?{data}:{})}},status);
async function protocol(req,env,kind) {
  if (req.method !== 'POST') return error('json_rpc_post_required',405);
  const msg = await read(req);
  if (!msg || Array.isArray(msg) || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(null,-32600,'Invalid JSON-RPC request');
  const rid = msg.id;
  const modern = kind === 'mcp' && (msg.method === 'server/discover' || req.headers.get('mcp-protocol-version') === '2026-07-28' || msg.params?._meta?.['io.modelcontextprotocol/protocolVersion'] === '2026-07-28');
  const wire = result => modern ? {...result, resultType:'complete', ttlMs:0, cacheScope:'private'} : result;
  const ok = result => json({jsonrpc:'2.0',id:rid,result:wire(result)});
  if (kind === 'mcp' && msg.method === 'notifications/initialized' && rid === undefined) return new Response(null,{status:202});
  if (typeof rid !== 'string' && !Number.isSafeInteger(rid)) return rpcError(null,-32600,'Request ID required');
  let name, args, key;
  if (kind === 'mcp') {
    const versions = ['2025-11-25','2025-06-18','2025-03-26','2026-07-28'];
    const info = {name:'xguard-paid-intelligence',version:'1.0.0'};
    if (msg.method === 'initialize') return ok({protocolVersion:versions.includes(msg.params?.protocolVersion) ? msg.params.protocolVersion : versions[0],capabilities:{tools:{}},serverInfo:info});
    if (msg.method === 'server/discover') return ok({serverInfo:info,supportedVersions:versions,ttlMs:0,cacheScope:'private',capabilities:{tools:{}}});
    if (msg.method === 'ping') return ok({});
    if (msg.method === 'tools/list') return ok(toolsList());
    if (msg.method !== 'tools/call') return rpcError(rid,-32601,'Unsupported method');
    name = msg.params?.name; args = msg.params?.arguments;
  } else {
    if (msg.method !== 'SendMessage') return rpcError(rid,-32601,'Unsupported method');
    const m = msg.params?.message;
    if (m?.role !== 'ROLE_USER' || typeof m.messageId !== 'string' || !Array.isArray(m.parts) || m.parts.length !== 1) return rpcError(rid,-32602,'Expected one user message');
    const data = m.parts[0]?.data;
    if (data?.action === 'xguard.discover') return ok({message:{messageId:crypto.randomUUID(),role:'ROLE_AGENT',parts:[{data:catalog()}]}});
    name = data?.action; key = data?.idempotency_key; args = data?.input ?? (name === 'xguard.fact.get' ? {fact:data.factId} : undefined);
  }
  if (name === 'xguard.fact.get') { name='xguard.facts'; args = {fact:args?.factId || args?.fact}; }
  const d = typeof name === 'string' && name.startsWith('xguard.') && routeFor(name.slice(7).replaceAll('_','-'));
  if (!d) return rpcError(rid,-32602,'Unsupported paid tool');
  const r = await purchase(req,env,d,args,kind === 'mcp' ? 'intelligence-mcp':'intelligence-a2a',key);
  const payload = await r.json(), h = new Headers(r.headers);
  const result = kind === 'mcp' ? {content:[{type:'text',text:JSON.stringify(payload)}],structuredContent:payload} : {message:{messageId:crypto.randomUUID(),role:'ROLE_AGENT',parts:[{data:payload}]}};
  const envelope = r.ok ? {jsonrpc:'2.0',id:rid,result:wire(result)} : {jsonrpc:'2.0',id:rid,error:{code:r.status===402?-32042:-32000,message:r.status===402?'Payment required':'Operation unavailable',data:payload}};
  return new Response(JSON.stringify(envelope),{status:r.status,headers:h});
}
async function dispatch(req,env,ctx,legacy) {
  const url = new URL(req.url), path=url.pathname;
  if (!isHost(url.hostname)) return error('unknown_host',421);
  if (url.protocol !== 'https:' || url.hostname === 'www.xguardgate.com') {
    url.protocol='https:'; if (url.hostname==='www.xguardgate.com') url.hostname='xguardgate.com';
    return Response.redirect(url.href,308);
  }
  if (req.method === 'OPTIONS') return new Response(null,{status:204});
  const at = path.startsWith(prefix) ? path.slice(ROOT.length) : path;
  if (at === '/admin/revenue') return ownerRevenue(req,env,read);
  if (isRead(req)) {
    if (at === '/catalog' || path === ROOT || discoveryPaths.has(path)) return json({...catalog(),new_payments_enabled:deployment.payment_state_write_version >= 7});
    if (at === '/openapi.json') return json(openApi());
    if (['/.well-known/agent-card.json','/.well-known/agent.json','/a2a/.well-known/agent-card.json'].includes(at)) return json(card());
    if (['/','/pricing','/marketplace','/developers','/install','/connect','/products'].includes(path)) return landing();
    if (at === '/server.json' || path === '/mcp/server-card') return json({name:'io.github.moelayyan90/xguard',description:TITLE,version:'1.0.0',remotes:[{type:'streamable-http',url:MCP}]});
    if (at === '/.well-known/x402' || at === '/supported') return json({x402Version:2,service_role:'resource_server',pricing:price(),services:BASE+'/catalog'});
    if (at === '/proof-key' || path === '/api/paid/v1/proof-key' || path === '/.well-known/xguard-proof-key.json') return json(await livePaidProofKey(env));
    if (path === '/llms.txt' || path === '/robots.txt') return new Response(path === '/robots.txt' ? 'User-agent: *\nAllow: /\nDisallow: /admin\nSitemap: https://xguardgate.com/sitemap.xml\n' : TITLE+'\n'+BASE+'/catalog\n'+MCP+'\n'+A2A+'\n', {headers:{'content-type':'text/plain; charset=utf-8'}});
    if (path === '/sitemap.xml') return new Response('<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">'+['https://xguardgate.com/',BASE+'/catalog',BASE+'/openapi.json'].map(s=>'<url><loc>'+s+'</loc></url>').join('')+'</urlset>',{headers:{'content-type':'application/xml'}});
    const ownership=glamaOwnershipFetch(req,env); if (ownership) return ownership;
    const paidResult=path.match(/^\/(?:api\/(?:intelligence|paid)\/v1|v1(?:\/marketplace)?)\/results\/(pay_[a-zA-Z0-9_-]{1,120})$/);
    if (paidResult) return recoverOutcome(env,paidResult[1],req.headers.get('x-xguard-quote') || '',id());
  }
  if (at === '/mcp' || at === '/a2a') return protocol(req,env,at.slice(1));
  if (path.startsWith(prefix)) {
    const service=routeFor(at.slice(1));
    if (service && req.method === 'POST') return purchase(req,env,service,await read(req),'intelligence-http');
    if (service) return error('post_required',405,{method:'POST',input_schema:service.schema});
    return error('route_not_found',404);
  }
  if (legacy && (/^\/admin(?:\/|$)/.test(path) || ['/healthz','/readyz','/api/paid/v1/readiness'].includes(path))) {
    if (path !== '/admin/login' && !await adminIdentity(req,env)) return error('owner_authentication_required',401);
    return legacy(req,env,ctx);
  }
  if (legacy && path === '/v1/checkout/webhooks/paypal' && req.method === 'POST') return legacy(req,env,ctx);
  if (legacy && isRead(req) && path === '/witness/verifier-key') return legacy(req,env,ctx);
  if (legacy && isRead(req) && /^\/v1\/checkout\/orders\/[a-zA-Z0-9_-]+(?:\/(?:receipt|result))?$/.test(path)) return legacy(req,env,ctx);
  if (isRead(req)) {
    const alias = path.match(/^\/(live|fact|history|changes|evidence)\/(.+)$/);
    if (alias) {
      const [adapter,...parts] = alias[2].split('/');
      let entity;
      try { entity = sourceSpec(adapter,parts.join('/')).id; } catch { /* A final segment may identify a fact or observation. */ }
      const last = parts.at(-1);
      if (!entity && parts.length > 1) {
        try { entity = sourceSpec(adapter,parts.slice(0,-1).join('/')).id; } catch { /* Unknown resource. */ }
      }
      if (!entity) return error('unknown_source',404);
      const hasField = entity !== alias[2], route = alias[1];
      const page = Number(url.searchParams.get('page') || 1);
      if (route === 'evidence' && hasField) return purchase(req,env,routeFor('evidence'),{entity,observation:last},'intelligence-http');
      if (route === 'changes') return purchase(req,env,routeFor('changes'),{entity,...(hasField ? {change:last} : {}),page},'intelligence-http');
      const defaultField = {npm:'latest-version',pypi:'latest-version',github:'latest-release',nodejs:'latest-version',python:'latest-listed-version',status:'service-status'};
      const field = hasField ? last : (url.searchParams.get('field') || defaultField[adapter]);
      const fact = field && canonicalFact(entity+'/'+field);
      if (!fact) return error('one_fact_field_required',400,{catalog:BASE+'/catalog'});
      if (route === 'history') return purchase(req,env,routeFor('history'),{fact,page},'intelligence-http');
      if (route === 'fact' || route === 'live') return purchase(req,env,routeFor('facts'),{fact},'intelligence-http');
      return error('observation_required',400);
    }
  }
  const oldPaid = path.match(/^\/api\/paid\/v1\/(batch|history|compare)$/);
  if (oldPaid && req.method === 'POST') return purchase(req,env,routeFor(oldPaid[1]),await read(req),'intelligence-http');
  // Retained legacy addresses cannot dispatch data, old prices, streams, or financial side effects.
  // Only registered and cost-bounded operations above can authorize settlement.
  if (/^\/(?:live|changes|corrections|status|search|topics|evidence|witness|verify|settle|v1|api|hooks|webhooks|routes|compute|network)(?:[./]|$)/.test(path))
    return error('service_temporarily_unavailable',503,{new_charge:false,catalog:BASE+'/catalog'});
  return error('route_not_found',404);
}
export async function intelligenceSurface(req,env,ctx,legacy) {
  let response;
  try { response = await dispatch(req,env,ctx,legacy); }
  catch (e) { response = error(e.status === 413 || e.status === 415 || e.status === 400 ? e.message : 'intelligence_unavailable',e.status || 503); }
  return final(req,response,env);
}
