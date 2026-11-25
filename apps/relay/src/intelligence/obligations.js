import { c2spWitnessRoute, originHashHex, PINNED_LOGS } from '../c2sp-witness.js';
import { actionFetch } from '../action/gateway.js';
import { computeFetch } from '../compute/gateway.js';
import { networkFetch } from '../network-entry.js';
import { livePaidFetch } from '../live-paid-entry.js';
import { LIVE_PAID } from '../live/paid-data.ts';
import { FEE_SERVICE } from '../financial-authority/fees.js';

export const witnessOrigin = 'gblin.digital/receipts-log';
const creditPaths = new Set([...LIVE_PAID, FEE_SERVICE].map(service => '/api/paid/v1/' + service.route));
const witnessDiscovery = new Set(['/witness', '/witness/', '/witness/metadata', '/witness/verifier-key']);

export async function existingObligation(request, env, ctx) {
  const path = new URL(request.url).pathname;
  const read = request.method === 'GET' || request.method === 'HEAD';
  const post = request.method === 'POST';
  if (path.startsWith('/witness')) {
    if (read && witnessDiscovery.has(path)) return c2spWitnessRoute(request, env);
    if (post && path === '/witness/add-checkpoint') {
      // The witness itself verifies the signed note, pinned identity and consistency
      // proof. Additional signers require their own commercial agreement.
      if (Object.keys(PINNED_LOGS).length === 1 && PINNED_LOGS[witnessOrigin])
        return c2spWitnessRoute(request, env);
    }
    const monitor = read && /^\/witness\/([a-f0-9]{64})\/(?:checkpoint|status)$/.exec(path);
    if (monitor && monitor[1] === await originHashHex(witnessOrigin)) return c2spWitnessRoute(request, env);
    return null;
  }
  if (post && path === '/v1/checkout/webhooks/paypal') return actionFetch(request, env);
  if (read && /^\/v1\/checkout\/orders\/xgo_[a-f0-9]{40}$/.test(path)) return actionFetch(request, env);
  if (read && /^\/v1\/compute\/(?:executions|receipts)\/xcq_[a-f0-9]{32}$/.test(path)) {
    if (!request.headers.get('x-xguard-quote')) return Response.json({error: 'execution_not_found'}, {status: 404});
    return computeFetch(request, env);
  }
  const task = /^\/v1\/(?:tasks|schedules)\/xgtask_[a-f0-9]{32}(?:\/(resume|verify|cancel))?$/.exec(path);
  if (task && (task[1] ? post : read)) {
    if (!request.headers.get('authorization')?.startsWith('Bearer ')) return Response.json({error: 'task_not_found'}, {status: 404});
    return networkFetch(request, env, ctx);
  }
  if (post && creditPaths.has(path) && request.headers.get('x-xguard-credit') &&
      request.headers.get('x-xguard-quote') && !request.headers.has('payment-signature'))
    return livePaidFetch(request, env, ctx);
  return null;
}
