// Existing Durable Object classes must remain exported so old durable records,
// alarms, receipts and financial recovery state are preserved across deployment.
export * from './canonical-entry.js';
export { LiveShard, LiveControl } from './live/objects.ts';
import live from './live/worker.ts';
import { liveMcpFetch } from './live/mcp.ts';
import { recoverOutcome } from './paid-agent-entry.js';
import { livePaidFetch } from './live-paid-entry.js';
export default {
  ...live,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname;
    if (path === '/mcp' && ['xguardgate.com', 'api.xguardgate.com'].includes(url.hostname)) return liveMcpFetch(request, env);
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
