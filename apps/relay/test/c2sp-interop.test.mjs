import assert from 'node:assert/strict';
import test from 'node:test';
import { C2SPWitness, C2SPWitnessCore, parseCheckpointNote, MAX_REQUEST_BYTES } from '../src/c2sp-witness.js';
import { runInterop, testLogs, vectors } from './c2sp-interop-helpers.mjs';

function fixture() {
  const values = new Map();
  let keyWrites = 0;
  const state = {
    storage: {
      async get(k) { await Promise.resolve(); return structuredClone(values.get(k)); },
      async put(k, v) { if (k === 'witness:key:v1') keyWrites++; await Promise.resolve(); values.set(k, structuredClone(v)); },
    },
    blockConcurrencyWhile(fn) { return fn(); },
  };
  return { state, values, keyWrites: () => keyWrites };
}
const req = (path, init) => new Request('https://api.xguardgate.com' + path, init);

test('GBLIN Go reference vectors: wire responses, consistency, monitoring and concurrent updates', async () => {
  const f = fixture();
  const w = new C2SPWitnessCore(f.state, testLogs);
  const send = (path, init) => w.fetch(req(path, init));
  const key = (await (await send('/witness/verifier-key')).text()).trim();
  await runInterop(send, key);
});

test('concurrent cold-start metadata and pushes retain one identity across restart', async () => {
  const f = fixture();
  const w = new C2SPWitnessCore(f.state, testLogs);
  const first = vectors.steps.find(x => x.name === 'first checkpoint size 5');
  const results = await Promise.all(Array.from({ length: 16 }, (_, i) => w.fetch(req(i % 2 ? '/witness/verifier-key' : '/witness'))));
  const keys = await Promise.all(results.map(async (r, i) => i % 2 ? (await r.text()).trim() : (await r.json()).verifier_key));
  assert.equal(new Set(keys).size, 1);
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: first.body }))).status, 200);
  assert.equal(f.keyWrites(), 1);
  const restarted = new C2SPWitnessCore(f.state, testLogs);
  assert.equal((await (await restarted.fetch(req('/witness/verifier-key'))).text()).trim(), keys[0]);
  assert.equal((await restarted.fetch(req(`/witness/${vectors.originHash}/checkpoint`))).status, 200);
});

test('production class ignores environment trust overrides and inherited property origins', async () => {
  const f = fixture();
  const w = new C2SPWitness(f.state, { PINNED_LOGS: testLogs });
  const first = vectors.steps.find(x => x.name === 'first checkpoint size 5');
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: first.body }))).status, 404);
  const inherited = first.body.replaceAll(vectors.origin, 'constructor');
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: inherited }))).status, 404);
});

test('missing trusted signature is 403; invalid UTF-8 and empty extension lines fail closed', async () => {
  const w = new C2SPWitnessCore(fixture().state, testLogs);
  const first = vectors.steps.find(x => x.name === 'first checkpoint size 5');
  const unsigned = first.body.slice(0, first.body.indexOf('— '));
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: unsigned }))).status, 403);
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: Uint8Array.of(0xff) }))).status, 400);
  const note = first.body.slice(first.body.indexOf('\n\n') + 2);
  assert.throws(() => parseCheckpointNote(note.replace('\n\n—', '\n\nextra\n\n—')));
});

test('byte cap bounds streamed bodies including multi-byte text', async () => {
  const w = new C2SPWitnessCore(fixture().state, testLogs);
  for (const body of ['x'.repeat(MAX_REQUEST_BYTES + 1), '—'.repeat(Math.floor(MAX_REQUEST_BYTES / 3) + 1)]) {
    assert.equal((await w.fetch(req('/witness/add-checkpoint', { method: 'POST', body }))).status, 413);
  }
});

test('storage failures never return a cosignature or rotate an existing damaged key', async () => {
  const f = fixture();
  const w = new C2SPWitnessCore(f.state, testLogs);
  await w.keyReady;
  const original = f.state.storage.put;
  f.state.storage.put = async (key, value) => { if (key.startsWith('witness:head:')) throw new Error('test storage failure'); return original(key, value); };
  const first = vectors.steps.find(x => x.name === 'first checkpoint size 5');
  const failed = await w.fetch(req(first.path, { method: 'POST', body: first.body }));
  assert.equal(failed.status, 503);
  assert.equal(await failed.text(), 'witness unavailable\n');
  f.state.storage.put = original;
  assert.equal((await w.fetch(req(first.path, { method: 'POST', body: first.body }))).status, 200);
  const bad = fixture();
  bad.values.set('witness:key:v1', { publicRaw: 'broken' });
  const broken = new C2SPWitnessCore(bad.state, testLogs);
  assert.equal((await broken.fetch(req('/witness'))).status, 503);
  assert.equal(bad.keyWrites(), 0);
});
