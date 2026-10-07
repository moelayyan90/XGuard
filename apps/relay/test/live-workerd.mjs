import { Miniflare, convertV4MiniflareOptions, Response as MFResponse } from 'miniflare';
import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
const path = process.env.LIVE_WORKER_BUNDLE || fileURLToPath(new URL('../../../.live-build/live-entry.js', import.meta.url));
let fixtureVersion = '1.0.0', sourceCalls = 0;
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, rootPath: resolve(path, '..'), workers: [{ name: 'live-test', modules: true, modulesRoot: resolve(path, '..'), scriptPath: path, compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
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
  assert.equal((await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'application/json' } })).headers.get('content-type'), 'application/json; charset=utf-8');
  assert.match(await (await mf.dispatchFetch('https://xguardgate.com/', { headers: { accept: 'text/html' } })).text(), /The live facts/);
  console.log('workerd integration: 32 SQLite shards, durable alarms, source collection, changed-value history, auth and format cache verified; isolated source fixtures only.');
} finally { await mf.dispose(); }
