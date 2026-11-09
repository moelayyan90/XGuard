import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { runInterop, testLogs, vectors } from './c2sp-interop-helpers.mjs';

const persist = await mkdtemp(join(tmpdir(), 'xguard-c2sp-'));
const source = fileURLToPath(new URL('../src/c2sp-witness.js', import.meta.url));
const bundle = await build({ stdin: { resolveDir: dirname(source), contents: `
  import { C2SPWitnessCore, c2spWitnessRoute } from ${JSON.stringify(source)};
  export { C2SPWitness } from ${JSON.stringify(source)};
  export class InteropWitness extends C2SPWitnessCore {
    constructor(state, env) { super(state, ${JSON.stringify(testLogs)}); }
  }
  export default { async fetch(request, env) {
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
      C2SP_WITNESS: { className: 'C2SPWitness', useSQLite: true },
      INTEROP: { className: 'InteropWitness', useSQLite: true },
    },
  }] }));
}
let mf;
try {
  mf = create();
  await mf.ready;
  const productionKeys = await Promise.all(Array.from({ length: 24 }, (_, i) => mf.dispatchFetch(`https://${i % 2 ? 'api.xguardgate.com' : 'xguardgate.com'}/witness/verifier-key`).then(r => r.text())));
  assert.equal(new Set(productionKeys).size, 1, 'actual workerd constructor input gate preserves one cold-start key');
  const send = (path, init) => mf.dispatchFetch('https://fixture.test' + path, init);
  const key = (await (await send('/witness/verifier-key')).text()).trim();
  const result = await runInterop(send, key);
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
  assert.equal(await (await mf.dispatchFetch('https://api.xguardgate.com/witness/verifier-key')).text(), productionKeys[0]);
  console.log(JSON.stringify({ workerd_c2sp: 'passed', ...result, stable_cold_start_key: true, sqlite_restart: true, production_pins: true }));
} finally {
  if (mf) await mf.dispose();
  await rm(persist, { recursive: true, force: true });
}
