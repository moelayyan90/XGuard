import assert from "node:assert/strict";
import test from "node:test";
import {
  C2SPWitness,
  C2SPWitnessCore,
  MAX_PENDING_CHECKPOINTS,
  PINNED_LOGS,
  parseCheckpointNote,
  parseDecimal,
  verifyConsistency,
  verifyLogSignature,
} from "../src/c2sp-witness.js";
import { testLogs, vectors, verifyCosignature } from './c2sp-interop-helpers.mjs';

const te = new TextEncoder();

function cat(...parts) {
  const size = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(size);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function b64(bytes) {
  return Buffer.from(bytes).toString("base64");
}

async function sha256(bytes) {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
}

async function keyHash(name, alg, pub) {
  return (await sha256(cat(te.encode(name + "\n"), Uint8Array.of(alg), pub))).slice(0, 4);
}

async function signedCheckpoint(origin = "example.test/log", size = 1, extension = '') {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const hash = await keyHash(origin, 0x01, pub);
  const verifierKey = `${origin}+${Buffer.from(hash).toString("hex")}+${b64(cat(Uint8Array.of(0x01), pub))}`;
  const root = await sha256(te.encode("root"));
  const body = `${origin}\n${size}\n${b64(root)}\n${extension ? extension + '\n' : ''}`;
  const signature = new Uint8Array(await crypto.subtle.sign({ name: "Ed25519" }, pair.privateKey, te.encode(body)));
  const note = body + "\n" + `— ${origin} ${b64(cat(hash, signature))}\n`;
  return { note, verifierKey, root };
}

test("parses and verifies a C2SP signed checkpoint", async () => {
  const fixture = await signedCheckpoint();
  const note = parseCheckpointNote(fixture.note);
  assert.equal(note.origin, "example.test/log");
  assert.equal(note.size, 1);
  assert.equal(await verifyLogSignature(note, fixture.verifierKey), true);
});

test("rejects non-canonical decimal sizes", () => {
  assert.throws(() => parseDecimal("01"), /bad decimal/);
  assert.throws(() => parseDecimal("-1"), /bad decimal/);
});

test("verifies RFC 6962 consistency from one leaf to two leaves", async () => {
  const leaf1 = await sha256(cat(Uint8Array.of(0x00), te.encode("leaf-1")));
  const leaf2 = await sha256(cat(Uint8Array.of(0x00), te.encode("leaf-2")));
  const root2 = await sha256(cat(Uint8Array.of(0x01), leaf1, leaf2));
  assert.equal(await verifyConsistency(1, 2, leaf1, root2, [leaf2]), true);

  const bad = new Uint8Array(32);
  assert.equal(await verifyConsistency(1, 2, leaf1, root2, [bad]), false);
});

test("a local witness fixture generates a persistent public verifier key without exposing private key material", async () => {
  const memory = new Map();
  const state = {
    storage: {
      async get(key) { return memory.get(key); },
      async put(key, value) { memory.set(key, structuredClone(value)); },
    },
    async blockConcurrencyWhile(callback) { return callback(); },
  };
  const witness = new C2SPWitnessCore(state, PINNED_LOGS);
  const first = await witness.fetch(new Request("https://api.xguardgate.com/witness"));
  assert.equal(first.status, 200);
  const metadata = await first.json();
  assert.match(metadata.verifier_key, /^xguardgate\.com\/witness\+[0-9a-f]{8}\+/);
  assert.equal(metadata.push_endpoint, "https://api.xguardgate.com/witness/add-checkpoint");
  assert.equal(metadata.accepted_logs[0].origin, "gblin.digital/receipts-log");
  assert.equal(JSON.stringify(metadata).includes("private"), false);

  const second = await witness.fetch(new Request("https://api.xguardgate.com/witness/verifier-key"));
  assert.equal(second.status, 200);
  assert.equal((await second.text()).trim(), metadata.verifier_key);
});

function memoryState() {
  const values = new Map(); let writes = 0, failPut = false, gate;
  return { values, get writes() { return writes; }, set failPut(value) { failPut = value; }, set gate(value) { gate = value; },
    storage: { async get(key) { if (key.startsWith('witness:head:') && gate) await gate; return structuredClone(values.get(key)); },
      async put(key, value) { if (failPut) throw Error('fixture storage unavailable'); values.set(key, structuredClone(value)); writes++; } },
    blockConcurrencyWhile(fn) { return fn(); } };
}
const firstStep = vectors.steps.find(step => step.name === 'first checkpoint size 5');
const firstNote = firstStep.body.slice(firstStep.body.indexOf('\n\n') + 2);
const send = (witness, body) => witness.fetch(new Request('https://fixture.test/witness/add-checkpoint', { method: 'POST', body }));

test('same-body retries preserve the signature, timestamp and persisted checkpoint without writes', async () => {
  const state = memoryState(), witness = new C2SPWitnessCore(state, testLogs);
  assert.equal((await send(witness, firstStep.body)).status, 200);
  const before = structuredClone(state.values.get('witness:head:' + vectors.origin)), writes = state.writes;
  const results = await Promise.all(Array.from({ length: 8 }, () => send(witness, 'old 5\n\n' + firstNote)));
  for (const r of results) { assert.equal(r.status, 200); verifyCosignature(parseCheckpointNote(firstNote).body, (await r.text()).trim(), (await witness.metadata()).verifier_key); }
  assert.equal(state.writes, writes); assert.deepEqual(state.values.get('witness:head:' + vectors.origin), before);
  const forged = firstNote.replace(/(— [^ ]+ )(.{8})/, '$1AAAAAAAA');
  assert.equal((await send(witness, 'old 5\n\n' + forged)).status, 403);
  assert.equal(state.writes, writes);
});

test('production never creates or substitutes a missing or mismatched witness key', async () => {
  const empty = memoryState(), prod = new C2SPWitness(empty, {});
  assert.equal((await prod.fetch(new Request('https://fixture.test/witness'))).status, 503); assert.equal(empty.writes, 0);
  const state = memoryState(), local = new C2SPWitnessCore(state, testLogs); await local.metadata();
  const key = structuredClone(state.values.get('witness:key:v1')), writes = state.writes;
  const wrong = new C2SPWitness(state, { CF_VERSION_METADATA: { id: 'deployed' } });
  assert.equal((await wrong.fetch(new Request('https://fixture.test/witness'))).status, 503);
  assert.equal(state.writes, writes); assert.deepEqual(state.values.get('witness:key:v1'), key);
});

test('a valid oversized note cannot exceed the persisted record budget',async()=>{
  const fixture = await signedCheckpoint('large-fixture.test/log',1,'x'.repeat(100000)), state=memoryState();
  const witness=new C2SPWitnessCore(state,{'large-fixture.test/log':{origin:'large-fixture.test/log',vkey:fixture.verifierKey}});
  assert.equal((await send(witness,'old 0\n\n'+fixture.note)).status,413);
  assert.equal(state.values.has('witness:head:large-fixture.test/log'),false);assert.equal(state.writes,1);
});

test('missing established head and corrupted cached signature fail closed without key replacement', async () => {
  const state = memoryState(), original = new C2SPWitnessCore(state, testLogs); await send(original, firstStep.body);
  const vkey = (await original.metadata()).verifier_key, old = structuredClone(state.values.get('witness:head:' + vectors.origin));
  state.values.delete('witness:head:' + vectors.origin);
  const restarted = new C2SPWitnessCore(state, testLogs, vkey), writes = state.writes;
  assert.equal((await send(restarted, firstStep.body)).status, 503); assert.equal(state.writes, writes);
  const corrupted = structuredClone(old), note = parseCheckpointNote(corrupted.note), line = note.signatureLines.find(x => x.startsWith('— xguardgate.com/witness '));
  const bytes = Buffer.from(line.split(' ').at(-1), 'base64'); bytes[75] ^= 1;
  corrupted.note = corrupted.note.replace(line, '— xguardgate.com/witness ' + bytes.toString('base64'));
  state.values.set('witness:head:' + vectors.origin, corrupted);
  assert.equal((await send(restarted, 'old 5\n\n' + firstNote)).status, 503); assert.equal(state.writes, writes);
  state.values.set('witness:head:' + vectors.origin, old);
  assert.equal((await send(restarted, 'old 5\n\n' + firstNote)).status, 200); assert.equal(state.writes, writes);
});

test('bounded ingress and queue reject excess requests and recover after completion', async () => {
  const state = memoryState(), witness = new C2SPWitnessCore(state, testLogs); await witness.metadata();
  let release; state.gate = new Promise(resolve => { release = resolve; });
  const requests = Array.from({ length: MAX_PENDING_CHECKPOINTS + 6 }, () => send(witness, firstStep.body));
  const rejected = await Promise.all(requests.slice(MAX_PENDING_CHECKPOINTS));
  assert.ok(rejected.every(r => r.status === 429 && r.headers.get('retry-after') === '1'));
  assert.ok(witness.pendingCount <= MAX_PENDING_CHECKPOINTS); assert.equal(state.writes, 1);
  state.gate = undefined; release();
  const accepted = await Promise.all(requests.slice(0, MAX_PENDING_CHECKPOINTS));
  assert.equal(accepted.filter(r => r.status === 200).length, 1); assert.equal(accepted.filter(r => r.status === 409).length, MAX_PENDING_CHECKPOINTS - 1);
  assert.equal(witness.pendingCount, 0); assert.equal(witness.activeRequests, 0);
  assert.equal((await send(witness, 'old 5\n\n' + firstNote)).status, 200);
});

test('storage failure leaves the last head intact and never poisons the update queue', async () => {
  const state = memoryState(), witness = new C2SPWitnessCore(state, testLogs); await witness.metadata();
  state.failPut = true; assert.equal((await send(witness, firstStep.body)).status, 503);
  assert.equal(state.values.has('witness:head:' + vectors.origin), false); assert.equal(witness.pendingCount, 0);
  state.failPut = false; assert.equal((await send(witness, firstStep.body)).status, 200);
});
