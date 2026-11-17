import assert from 'node:assert/strict';
import { resolve } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';
import { GLAMA_ORIGINS, GLAMA_PROOF_PATHS, GLAMA_SCHEMA, GLAMA_OWNERSHIP, requireGlamaClaim } from '../src/glama-ownership.js';

// The actual public proof is copied from the owner's Glama claim panel. No
// generated or synthetic token is substituted during build or deployment.
assert.ok(GLAMA_OWNERSHIP.$schema === GLAMA_SCHEMA, 'Configured Glama proof schema must match');
const claim = requireGlamaClaim(GLAMA_OWNERSHIP.claim);
const bundle = resolve('.live-build/live-entry.js');
let outbound = 0;
const workers = [{ name: 'configured', modules: true,
  modulesRoot: resolve('.live-build'), scriptPath: bundle,
  compatibilityDate: '2026-08-25', compatibilityFlags: ['nodejs_compat'],
  bindings: { LIVE_BOOTSTRAP: 'off' },
  outboundService: async () => { outbound++; throw Error('Ownership proof cannot make outbound calls'); },
}];
const mf = new Miniflare(convertV4MiniflareOptions({ host: '127.0.0.1', port: 0, workers }));
try {
  await mf.ready;
  for (const name of ['configured']) {
    const worker = await mf.getWorker(name);
    for (const origin of GLAMA_ORIGINS) for (const path of GLAMA_PROOF_PATHS) {
      const response = await worker.fetch(origin + path);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type') || '', /^application\/json/);
      assert.equal(response.headers.has('location'), false);
      const body = await response.json();
      assert.equal(body.$schema, GLAMA_SCHEMA);
      assert.ok(body.claim === claim, 'Bundled Worker must return the configured claim exactly');
      const head = await worker.fetch(origin + path, { method: 'HEAD' });
      assert.equal(head.status, response.status); assert.equal(await head.text(), '');
    }
  }
  assert.equal(outbound, 0);
  console.log(JSON.stringify({ glama_runtime: 'passed', configured_proof: true, storage_bindings: 0, outbound_calls: 0, owner_token_source: 'repository-proof', ownership_accepted_by_glama: 'not_checked' }));
} finally { await mf.dispose(); }
