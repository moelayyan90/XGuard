import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const path = process.env.LIVE_WORKER_BUNDLE || fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
const fixtureDir = await mkdtemp(join(tmpdir(), 'xguard-live-collector-'));
const fixturePath = join(fixtureDir, 'entry.js');
// Keep the actual release fetch/alarm implementation. Only this test subclass
// seeds a full allowance in ephemeral SQLite: the UTC quota policy has its own
// Store tests, and late-day proration must not delay this alarm test overnight.
await build({ stdin: { resolveDir: resolve(path, '..'), contents: `
  import worker, { LiveShard as ReleaseLiveShard } from ${JSON.stringify(path)};
  export * from ${JSON.stringify(path)};
  export default worker;
  export class LiveShard extends ReleaseLiveShard {
    constructor(state, env) {
      super(state, env);
      this.store.set('source-write-budget-v1', {day:new Date().toISOString().slice(0,10),rows_written:0,paused:false,allocation:1600,limit:1600});
    }
  }
` }, bundle: true, format: 'esm', platform: 'browser', external: ['url', 'node:*', 'cloudflare:*'], target: 'es2022', outfile: fixturePath });
let fixtureVersion = '1.0.0', sourceCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: fixtureDir, workers: [{ name: 'live-test', modules: true, modulesRoot: fixtureDir, scriptPath: fixturePath, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  durableObjects: { LIVE_SHARDS: { className: 'LiveShard', useSQLite: true }, LIVE_CONTROL: { className: 'LiveControl', useSQLite: true } },
  bindings: { LIVE_BOOTSTRAP: 'off', LIVE_SOURCE_FETCHES: 'on', MONETIZATION_MODE: 'observe' },
  outboundService: async request => {
    const url = new URL(request.url);
    if (['cloudflare-dns.com', 'one.one.one.one', 'dns.google'].includes(url.hostname)) return MFResponse.json({ Status: 0, Answer: url.searchParams.get('type') === 'A' ? [{ type: 1, data: '93.184.216.34' }] : [] });
    if (url.hostname === 'registry.npmjs.org' && url.pathname === '/robots.txt') return new MFResponse('', {status:404});
    if (url.hostname === 'registry.npmjs.org' && url.pathname === '/react/latest') { sourceCalls++; return MFResponse.json({ name:'react',version:fixtureVersion,license:'MIT',engines:{node:'>=18'} }); }
    throw new Error('Unexpected outbound destination in isolated collector fixture');
  } }] }));
try {
  await mf.ready;
  const response = await mf.dispatchFetch('https://xguardgate.com/healthz');
  assert.equal(response.status, 200); const body = await response.json(); assert.equal(body.shards, 32); assert.equal(body.facts, 0);
  const {shardOf,shardName} = await import('../src/live/util.ts');
  const ns = await mf.getDurableObjectNamespace('LIVE_SHARDS'); const stub = ns.get(ns.idFromName(shardName(shardOf('npm/react'))));
  const rpc = (op, data={}) => stub.fetch('https://internal/rpc', {method:'POST',body:JSON.stringify({op,...data})}).then(x=>x.json());
  assert.equal((await rpc('seed',{sources:[{adapter:'npm',identifier:'react'}]})).queued,1);
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/admin')).status, 401);
  const waitForValue = async expected => {
    for(let i=0;i<80;i++) {
      const current=await rpc('fact',{id:'npm/react/latest-version'});
      if(current?.current_value===expected) return current;
      await new Promise(resolve=>setTimeout(resolve,250));
    }
    throw new Error('Durable collector did not publish the expected fixture');
  };
  const first=await waitForValue('1.0.0'); assert.equal(first.verification,'VERIFIED');
  fixtureVersion='2.0.0'; await rpc('refresh',{id:'npm/react'});
  const second=await waitForValue('2.0.0'); assert.equal(second.previous_value,'1.0.0');
  const history=await rpc('history',{id:'npm/react/latest-version',page:1}); assert.equal(history.length,2);
  assert.equal(history[1].value,'1.0.0'); assert.equal(sourceCalls,2);
  await rpc('refresh',{id:'npm/react'});
  let third;
  for(let i=0;i<80;i++) { third=await rpc('fact',{id:'npm/react/latest-version'}); if(third.verified_at>second.verified_at) break; await new Promise(resolve=>setTimeout(resolve,250)); }
  assert.equal(sourceCalls,3);
  assert.ok(third.verified_at>second.verified_at);
  assert.equal((await rpc('history',{id:'npm/react/latest-version',page:1})).length,2,'identical HTTP 200 responses revalidate existing evidence without duplicate observations');
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'application/json' } })).headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(await (await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'text/html' } })).text(), /XGUARD ACTION CLOUD/);
  // Exercise the actual release smoke programs against the isolated Worker.
  // This catches stale retired-route assumptions before a production canary.
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = (input, init) => mf.dispatchFetch(input, init);
    await import('../../../scripts/live-smoke.mjs');
    await import('../../../scripts/action-production-check.mjs');
  } finally { globalThis.fetch = originalFetch; }
  console.log('workerd integration: 32 SQLite shards, durable alarms, source collection, changed-value history, auth and format cache verified; isolated source fixtures only.');
} finally { await mf.dispose(); await rm(fixtureDir, {recursive:true,force:true}); }
