import { WorkerEntrypoint } from 'cloudflare:workers';
import handler from './live-handler.js';
import live from './live/worker.ts';
import { canonicalFact } from './live/paid-data.ts';

export * from './live-handler.js';

export default class XGuard extends WorkerEntrypoint {
  fetch(request) {
    return handler.fetch(request, this.env, this.ctx);
  }

  scheduled(event) {
    return handler.scheduled(event, this.env, this.ctx);
  }

  // Workers RPC is available only through an account-owned service binding.
  // The caller can read one canonical fact. It cannot supply an origin or headers.
  readSettlementFact(id) {
    if (!canonicalFact(id)) return Response.json({error: 'invalid_fact'}, {status: 400});
    const request = new Request('https://xguard-origin.internal/fact/' + id + '?format=json', {
      headers: {accept: 'application/json'},
    });
    return live.fetch(request, this.env, this.ctx);
  }
}
