// Existing Durable Object classes must remain exported so old durable records,
// alarms, receipts and financial recovery state are preserved across deployment.
export * from './canonical-entry.js';
export { LiveShard, LiveControl } from './live/objects.ts';
import live from './live/worker.ts';
import { recoverOutcome } from './paid-agent-entry.js';
export default {
  ...live,
  async fetch(request, env, ctx) {
    // Preserve access to results already paid for, without new execution or settlement.
    const match = new URL(request.url).pathname.match(/^\/v1\/(?:marketplace\/)?results\/(pay_[A-Za-z0-9_-]+)$/);
    if (match && ['GET', 'HEAD'].includes(request.method)) {
      const response = await recoverOutcome(env, match[1], request.headers.get('x-xguard-quote') || '', `xgr_${crypto.randomUUID().replaceAll('-', '')}`);
      const headers = new Headers(response.headers);
      headers.set('cache-control', 'no-store'); headers.set('x-robots-tag', 'noindex');
      return new Response(request.method === 'HEAD' ? null : response.body, { status: response.status, headers });
    }
    return live.fetch(request, env, ctx);
  },
};
