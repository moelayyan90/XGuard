import assert from "node:assert/strict";
import test from "node:test";
import {
  C2SPWitness,
  parseCheckpointNote,
  parseDecimal,
  verifyConsistency,
  verifyLogSignature,
} from "../src/c2sp-witness.js";

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

async function signedCheckpoint(origin = "example.test/log", size = 1) {
  const pair = await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"]);
  const pub = new Uint8Array(await crypto.subtle.exportKey("raw", pair.publicKey));
  const hash = await keyHash(origin, 0x01, pub);
  const verifierKey = `${origin}+${Buffer.from(hash).toString("hex")}+${b64(cat(Uint8Array.of(0x01), pub))}`;
  const root = await sha256(te.encode("root"));
  const body = `${origin}\n${size}\n${b64(root)}\n`;
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

test("witness metadata generates a persistent public verifier key without exposing private key material", async () => {
  const memory = new Map();
  const state = {
    storage: {
      async get(key) { return memory.get(key); },
      async put(key, value) { memory.set(key, structuredClone(value)); },
    },
    async blockConcurrencyWhile(callback) { return callback(); },
  };
  const witness = new C2SPWitness(state, {});
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
