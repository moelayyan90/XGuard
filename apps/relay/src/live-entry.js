// Existing Durable Object classes must remain exported so old durable records,
// alarms, receipts and financial recovery state are preserved across deployment.
export * from './canonical-entry.js';
export { LiveShard, LiveControl } from './live/objects.ts';
export { C2SPWitness } from './c2sp-witness.js';
import live from './live/worker.ts';
import { A2A_CARD_PATH, A2A_PATH, liveA2aFetch, liveAgentCard } from './live/a2a.ts';
import { liveMcpFetch } from './live/mcp.ts';
import { recoverOutcome, performWebFetch } from './paid-agent-entry.js';
import { livePaidFetch } from './live-paid-entry.js';
import { facilitatorSurface } from './facilitator-surface.js';
import { networkFetch } from './network-entry.js';
import { refreshCapabilityGraph } from './network/engine.ts';
import { c2spWitnessRoute } from './c2sp-witness.js';
export default {
  ...live,
  async scheduled(event, env, ctx) {
    await live.scheduled(event, env, ctx);
    ctx.waitUntil(refreshCapabilityGraph(env, performWebFetch).catch(() => console.warn(JSON.stringify({event:'network_graph_refresh_unavailable'}))));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    const network = await networkFetch(request, env, ctx);
    if (network) return network;
    const witness = await c2spWitnessRoute(request, env);
    if (witness) return witness;
    if (['xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) {
      const facilitator = await facilitatorSurface(request, env);
      if (facilitator) {
        const headers = new Headers(facilitator.headers);
        if (env.CF_VERSION_METADATA?.id) headers.set('x-xguard-worker-version-id', env.CF_VERSION_METADATA.id);
        if (env.CF_VERSION_METADATA?.tag) headers.set('x-xguard-worker-version-tag', env.CF_VERSION_METADATA.tag);
        return new Response(facilitator.body, { status: facilitator.status, headers });
      }
    }
    const readFact = factRequest => live.fetch(factRequest, env, ctx);
    if (['xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) {
      if ([A2A_CARD_PATH, A2A_PATH + A2A_CARD_PATH].includes(path) && ['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return liveAgentCard(request, env);
      if (path === A2A_PATH) return liveA2aFetch(request, env, readFact);
    }
    if (path === '/mcp' && ['xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) {
      if (['GET', 'HEAD', 'POST', 'OPTIONS', 'DELETE'].includes(request.method)) return liveMcpFetch(request, env, readFact);
    }
    if (path === '/api/gateway/v1' || path.startsWith('/api/gateway/v1/')) {
      if (['www.xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) {
        // The x402 authorization is bound to the canonical resource.
        return Response.redirect('https://xguardgate.com' + path + url.search, 308);
      }
      if (!env.XGUARD_SETTLEMENT) {
        return Response.json({ error: 'gateway_unavailable' }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
      }
      try {
        return await env.XGUARD_SETTLEMENT.fetch(request);
      } catch {
        return Response.json({ error: 'gateway_unavailable' }, { status: 503, headers: { 'cache-control': 'private, no-store' } });
      }
    }
    if (/^\/api\/paid\/v1(?:\/|$)/.test(path)) return livePaidFetch(request, env, ctx);
    // Preserve access to results already paid for, without new execution or settlement.
    const match = path.match(/^\/v1\/(?:marketplace\/)?results\/(pay_[A-Za-z0-9_-]+)$/);
    if (match && ['GET', 'HEAD'].includes(request.method)) {
      const response = await recoverOutcome(env, match[1], request.headers.get('x-xguard-quote') || '', `xgr_${crypto.randomUUID().replaceAll('-', '')}`);
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store'); headers.set('x-robots-tag', 'noindex');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    }
    return live.fetch(request, env, ctx);
  },
};
