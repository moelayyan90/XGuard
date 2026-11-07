import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
const scriptPath = resolve('.live-build/live-entry.js'); let outbound = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: [{ name: 'agent402-test', modules: true, modulesRoot: resolve('.live-build'), scriptPath, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'], bindings: { LIVE_BOOTSTRAP: 'off' }, outboundService: async () => { outbound++; throw Error('Unexpected outbound request'); } }] }));
try {
  await mf.ready;
  const get = (path, init = {}) => mf.dispatchFetch('https://api.xguardgate.com' + path, init);
  const r = await get('/supported'); assert.equal(r.status, 200); assert.equal(r.headers.has('location'), false);
  assert.deepEqual((await r.json()).kinds, [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }]);
  const d = await get('/.well-known/x402'); assert.equal(d.status, 200); assert.equal((await d.json()).role, 'facilitator');
  const page = await mf.dispatchFetch('https://xguardgate.com/identity'); assert.equal(page.status, 200); assert.match(await page.text(), /Mohammad Elayyan/);
  for (const path of ['/verify', '/settle']) {
    const r = await get(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 400); assert.equal(r.headers.has('location'), false); assert.ok(await r.json());
  }
  assert.equal(outbound, 0); console.log('Agent402 bundled workerd: discovery, operator HTML, invalid verify/settle and zero outbound calls passed.');
} finally { await mf.dispose(); }
