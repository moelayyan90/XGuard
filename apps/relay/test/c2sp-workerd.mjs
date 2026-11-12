import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { runInterop, testLogs, vectors, verifyCosignature } from './c2sp-interop-helpers.mjs';

const persist = await mkdtemp(join(tmpdir(), 'xguard-c2sp-'));
const source = fileURLToPath(new URL('../src/c2sp-witness.js', import.meta.url));
const bundle = await build({ stdin: { resolveDir: dirname(source), contents: `
  import { C2SPWitness, C2SPWitnessCore, c2spWitnessRoute, PINNED_LOGS } from ${JSON.stringify(source)};
  export { C2SPWitness };
  export class LocalPinnedLogsWitness extends C2SPWitnessCore { constructor(state) { super(state,PINNED_LOGS); } }
  export class InteropWitness extends C2SPWitnessCore {
    constructor(state, env) {
      let writes = 0;
      super({ storage: { get: state.storage.get.bind(state.storage), put: async (...args) => { const result = await state.storage.put(...args); writes++; return result; } }, blockConcurrencyWhile: state.blockConcurrencyWhile.bind(state) }, ${JSON.stringify(testLogs)});
      this.writes = () => writes;
    }
    async fetch(request) { if(new URL(request.url).pathname === '/fixture/writes') return Response.json({ writes: this.writes() }); return super.fetch(request); }
  }
  export default { async fetch(request, env) {
    if (new URL(request.url).hostname === 'missing-production-key.test') {
      return c2spWitnessRoute(new Request('https://api.xguardgate.com/witness'), { C2SP_WITNESS: env.EMPTY_PRODUCTION });
    }
    if (new URL(request.url).hostname === 'fixture.test') {
      return env.INTEROP.get(env.INTEROP.idFromName('reference-vector-log')).fetch(request);
    }
    return await c2spWitnessRoute(request, env) || new Response('not found', {status:404});
  }};
` }, format: 'esm', bundle: true, write: false });
function create() {
  return new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, resourcePersistencePath: persist, workers: [{
    name: 'c2sp-interop', modules: true, script: bundle.outputFiles[0].text,
    compatibilityDate: '2026-08-25',
    durableObjects: {
      C2SP_WITNESS: { className: 'LocalPinnedLogsWitness', useSQLite: true },
      EMPTY_PRODUCTION: { className: 'C2SPWitness', useSQLite: true },
      INTEROP: { className: 'InteropWitness', useSQLite: true },
    },
  }] }));
}
let mf;
try {
  mf = create();
  await mf.ready;
  assert.equal((await mf.dispatchFetch('https://missing-production-key.test/')).status,503,'the real production class fails closed with no provisioned key');
  const productionKeys = await Promise.all(Array.from({ length: 24 }, (_, i) => mf.dispatchFetch(`https://${i % 2 ? 'api.xguardgate.com' : 'xguardgate.com'}/witness/verifier-key`).then(r => r.text())));
  assert.equal(new Set(productionKeys).size, 1, 'actual workerd constructor input gate preserves one cold-start key');
  const send = (path, init) => mf.dispatchFetch('https://fixture.test' + path, init);
  const key = (await (await send('/witness/verifier-key')).text()).trim();
  const result = await runInterop(send, key);
  const statusPath = '/witness/' + vectors.originHash + '/status';
  const status = await (await send(statusPath)).json();
  assert.ok(status.observed_growth_events >= 2); assert.ok(status.recent_growth.length <= 32);
  assert.ok(status.recent_growth.every((e,i,a) => e.size > e.old_size && (!i || e.old_size === a[i-1].size)));
  for(const event of status.recent_growth) verifyCosignature(event.signed_body,event.cosignature,key);
  const originalHead = await (await send('/witness/' + vectors.originHash + '/checkpoint')).text();
  const beforeWrites = (await (await send('/fixture/writes')).json()).writes;
  for(let i=0;i<25;i++)assert.equal((await send('/witness/add-checkpoint',{method:'POST',body:'old '+result.held+'\n\n'+originalHead})).status,200);
  assert.equal((await (await send('/fixture/writes')).json()).writes,beforeWrites);
  assert.equal(await (await send('/witness/' + vectors.originHash + '/checkpoint')).text(),originalHead);
  const first = vectors.steps.find(x => x.name === 'first checkpoint size 5');
  const denied = await mf.dispatchFetch('https://api.xguardgate.com/witness/add-checkpoint', { method: 'POST', body: first.body });
  assert.equal(denied.status, 404, 'production binding never trusts the interop test key');
  const head = await mf.dispatchFetch('https://api.xguardgate.com/witness/verifier-key', { method: 'HEAD' });
  assert.equal(head.status, 200);
  assert.equal(await head.text(), '');
  const gblinHash = createHash('sha256').update('gblin.digital/receipts-log').digest('hex');
  assert.equal((await mf.dispatchFetch(`https://api.xguardgate.com/witness/${gblinHash}/checkpoint`)).status, 404);
  await mf.dispose();
  mf = create();
  await mf.ready;
  assert.equal((await (await send('/witness/verifier-key')).text()).trim(), key, 'SQLite key survives a real runtime restart');
  const checkpoint = await send(`/witness/${vectors.originHash}/checkpoint`);
  assert.equal(checkpoint.status, 200);
  assert.equal(Number((await checkpoint.text()).split('\n')[1]), result.held, 'latest accepted state survives restart');
  assert.deepEqual(await (await send(statusPath)).json(),status, 'bounded growth evidence survives restart');
  assert.equal(await (await mf.dispatchFetch('https://api.xguardgate.com/witness/verifier-key')).text(), productionKeys[0]);
  console.log(JSON.stringify({ workerd_c2sp: 'passed', ...result, stable_cold_start_key: true, sqlite_restart: true, production_pins: true }));
} finally {
  if (mf) await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
