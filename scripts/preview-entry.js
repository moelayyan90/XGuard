// Local browser QA only. The production Wrangler entry remains unchanged.
export * from '../apps/relay/src/live-entry.js';
import app from '../apps/relay/src/live-entry.js';
export default {
  ...app,
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname !== '/__preview/mobile') return app.fetch(request, env, ctx);
    const page = url.searchParams.get('page') === 'workspace' ? '/network' : '/';
    const response = await app.fetch(new Request('https://xguardgate.com' + page), env, ctx);
    const html = (await response.text()).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
    return new Response('<!doctype html><html lang="en"><meta name="viewport" content="width=device-width,initial-scale=1"><title>XGuard — 390px responsive QA</title><body style="margin:0;background:#172130;display:grid;place-items:start center"><iframe title="Mobile viewport, 390 pixels" style="width:390px;height:880px;border:0;max-width:100%;background:#090e17" srcdoc="' + html + '"></iframe></body></html>', { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
  },
};
