import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { shardName, shardOf } from '../src/live/util.ts';
const current = fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
assert.ok(process.env.LIVE_BASELINE_BUNDLE, 'Build the exact pre-change revision separately and supply LIVE_BASELINE_BUNDLE');
const bundles = { before: resolve(process.env.LIVE_BASELINE_BUNDLE), after: current };
const worker = (name, scriptPath) => ({ name, modules: true, modulesRoot: resolve(scriptPath, '..'), scriptPath, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LIVE_SHARDS: { className: 'LiveShard', useSQLite: true }, LIVE_CONTROL: { className: 'LiveControl', useSQLite: true } },
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'on', MONETIZATION_MODE: 'observe' },
  outboundService: async request => { const u = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(u.hostname)) return MFResponse.json({ Status: 0, Answer: u.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (u.hostname === 'registry.npmjs.org' && u.pathname === '/robots.txt') return new MFResponse('', { status: 404 });
    if (u.hostname === 'registry.npmjs.org' && u.pathname === '/react/latest') return MFResponse.json({ name: 'react', version: '1.2.3', license: 'MIT' });
    throw new Error('Unexpected external request during compatibility test');
  },
});
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers: Object.entries(bundles).map(([name, path]) => worker(name, path)) }));
try {
  await mf.ready;
  const fetchers = Object.fromEntries(await Promise.all(Object.keys(bundles).map(async name => [name, await mf.getWorker(name)])));
  for (const name of Object.keys(bundles)) {
    const ns = await mf.getDurableObjectNamespace('LIVE_SHARDS', name), stub = ns.get(ns.idFromName(shardName(shardOf('npm/react'))));
    const rpc = (op, data = {}) => stub.fetch('https://internal/rpc', { method: 'POST', body: JSON.stringify({ ...data, op }) }).then(r => r.json());
    await rpc('seed', { sources: [{ adapter: 'npm', identifier: 'react' }] });
    for (let i = 0; i < 80; i++) { if ((await rpc('fact', { id: 'npm/react/latest-version' }))?.current_value === '1.2.3') break; await new Promise(r => setTimeout(r, 250)); }
    assert.equal((await rpc('fact', { id: 'npm/react/latest-version' })).current_value, '1.2.3');
  }
  const cases = ['/robots.txt', '/llms.txt', '/identity', '/fact/npm/react/latest-version', '/history/npm/react/latest-version', '/live/npm/react', '/topics', '/sitemap.xml'];
  for (const path of cases) for (const accept of ['text/html', 'text/markdown', 'application/json']) {
    const pair = await Promise.all(Object.values(fetchers).map(w => w.fetch(`https://xguardgate.com${path}`, { headers: { accept, 'user-agent': 'XGuardLiveSmoke/1.0' } })));
    assert.equal(pair[0].status, pair[1].status, `${path} ${accept}`); assert.equal(pair[1].status, 200);
    assert.equal(pair[0].headers.get('content-type'), pair[1].headers.get('content-type'));
    const cachePolicy = pair.map(r => r.headers.get('cache-control') || '');
    assert.equal(cachePolicy[0].replace(/max-age=\d+/, 'max-age=N'), cachePolicy[1].replace(/max-age=\d+/, 'max-age=N'));
    assert.ok(Math.abs(Number(cachePolicy[0].match(/max-age=(\d+)/)?.[1] || 0) - Number(cachePolicy[1].match(/max-age=(\d+)/)?.[1] || 0)) <= 1, 'Only the elapsed one-second cache boundary may differ');
    assert.equal(pair[1].headers.has('payment-required'), false);
    const texts = await Promise.all(pair.map(r => r.text()));
    if (['/robots.txt', '/llms.txt', '/identity'].includes(path)) assert.equal(texts[0], texts[1]);
    if (path.startsWith('/fact/')) { assert.ok(texts.every(t => t.includes('1.2.3'))); assert.ok(texts.every(t => t.includes('registry.npmjs.org/react/latest'))); }
  }
  const samples = { before: [], after: [] }, cache = { before: {}, after: {} };
  for (let i = 0; i < 70; i++) for (const name of i % 2 ? ['after', 'before'] : ['before', 'after']) {
    const start = performance.now(), r = await fetchers[name].fetch('https://xguardgate.com/fact/npm/react/latest-version', { headers: { accept: 'application/json', 'user-agent': 'XGuardLiveSmoke/1.0' } });
    await r.arrayBuffer(); assert.equal(r.status, 200);
    if (i >= 10) samples[name].push(performance.now() - start);
    const hit = r.headers.get('x-xguard-cache') || 'unknown'; cache[name][hit] = (cache[name][hit] || 0) + 1;
  }
  const quantiles = values => { const a = [...values].sort((a, b) => a - b); return { n: a.length, p50_ms: Number(a[Math.floor(a.length * .5)].toFixed(3)), p95_ms: Number(a[Math.floor(a.length * .95)].toFixed(3)) }; };
  const result = { baseline_sha: process.env.LIVE_BASELINE_SHA || null, scope: 'Local paired workerd fixtures, alternating request order, warmed cache. Not production traffic, provider billing, or an uptime claim.', compatibility_cases: cases.length * 3, before: quantiles(samples.before), after: quantiles(samples.after), cache };
  assert.ok(result.after.p95_ms <= Math.max(result.before.p95_ms * 1.5, result.before.p95_ms + 5), JSON.stringify(result));
  assert.equal(cache.before.HIT, cache.after.HIT);
  console.log(JSON.stringify(result));
  if (process.env.LIVE_COMPATIBILITY_REPORT) await writeFile(process.env.LIVE_COMPATIBILITY_REPORT, JSON.stringify(result, null, 2));
} finally { await mf.dispose(); }
