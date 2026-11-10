import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { readFileSync } from 'node:fs';

export const vectors = JSON.parse(readFileSync(new URL('./fixtures/gblin-witness-vectors.json', import.meta.url)));
export const testLogs = Object.freeze({ [vectors.origin]: { origin: vectors.origin, vkey: vectors.logVkey } });

function canonicalHash(value) {
  assert.equal(typeof value, 'string', 'consistency hash must be base64 text');
  const bytes = Buffer.from(value, 'base64');
  assert.equal(bytes.length, 32, 'consistency hash must be 32 bytes');
  assert.equal(bytes.toString('base64'), value, 'consistency hash must use canonical base64');
  return value;
}

export function parseConsistencyPayload(raw, contentType, expected) {
  let lines;
  if (String(contentType || '').toLowerCase().includes('application/json') || String(raw).trimStart().startsWith('{')) {
    const body = JSON.parse(raw);
    assert.equal(body.origin, expected.origin, 'consistency origin');
    assert.equal(body.old, expected.old, 'consistency old size');
    assert.equal(body.new, expected.new, 'consistency new size');
    assert.equal(canonicalHash(body.old_root), expected.oldRoot, 'consistency old root');
    assert.equal(canonicalHash(body.new_root), expected.newRoot, 'consistency new root');
    assert.ok(Array.isArray(body.proof), 'consistency proof array');
    lines = body.proof;
  } else {
    lines = String(raw).trim().split('\n').filter(Boolean);
  }
  assert.ok(lines.length <= 63, 'consistency proof line limit');
  for (const line of lines) canonicalHash(line);
  return lines;
}

// Independent Node/OpenSSL verification of the wire cosignature, rather than
// asking the witness implementation to verify its own output.
export function verifyCosignature(text, line, vkey) {
  const parts = /^([^+]+)\+([0-9a-f]{8})\+(.+)$/.exec(vkey);
  assert.ok(parts, 'C2SP verifier key');
  const raw = Buffer.from(parts[3], 'base64');
  assert.equal(raw.length, 33);
  assert.equal(raw[0], 4);
  const hash = createHash('sha256').update(parts[1] + '\n').update(raw).digest().subarray(0, 4);
  assert.equal(hash.toString('hex'), parts[2]);
  const prefix = `— ${parts[1]} `;
  assert.ok(line.startsWith(prefix));
  const wire = line.slice(prefix.length).trimEnd();
  const payload = Buffer.from(wire, 'base64');
  assert.equal(payload.toString('base64'), wire);
  assert.equal(payload.length, 76);
  assert.deepEqual(payload.subarray(0, 4), hash);
  const timestamp = payload.readBigUInt64BE(4);
  assert.ok(timestamp > 0n && timestamp <= BigInt(Math.floor(Date.now() / 1000) + 30));
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(1)]), format: 'der', type: 'spki' });
  assert.equal(verify(null, Buffer.from(`cosignature/v1\ntime ${timestamp}\n${text}`), publicKey, payload.subarray(12)), true);
}

export async function runInterop(send, vkey) {
  let successful = 0;
  for (const step of vectors.steps) {
    const response = await send(step.path, { method: step.method, body: step.body });
    assert.equal(response.status, step.status, step.name);
    const body = await response.text();
    if (step.expectBody) assert.equal(body, step.expectBody, step.name);
    if (step.expectType) assert.equal(response.headers.get('content-type'), step.expectType, step.name);
    if (step.cosignedText) { verifyCosignature(step.cosignedText, body, vkey); successful++; }
    if (step.method === 'GET' && step.status === 200) {
      const split = body.lastIndexOf('\n\n');
      const text = body.slice(0, split + 1);
      const line = body.slice(split + 2).split('\n').find(x => x.startsWith('— xguardgate.com/witness '));
      assert.ok(line, step.name);
      verifyCosignature(text, line, vkey);
      assert.ok(body.includes(`— ${vectors.origin} `), 'monitor preserves the verified log signature');
      if (step.expectSize) assert.equal(Number(text.split('\n')[1]), step.expectSize);
    }
  }
  const raced = await Promise.all(vectors.raceBodies.map(body => send('/witness/add-checkpoint', { method: 'POST', body })));
  const winners = raced.map((r, i) => r.status === 200 ? i : -1).filter(i => i !== -1);
  assert.equal(winners.length, 1, 'exactly one concurrent growth request commits');
  const winner = winners[0];
  const held = vectors.raceSizes[winner];
  const texts = await Promise.all(raced.map(r => r.text()));
  for (let i = 0; i < raced.length; i++) {
    if (i === winner) {
      const note = vectors.raceBodies[i].split('\n\n').slice(1).join('\n\n');
      verifyCosignature(note.slice(0, note.lastIndexOf('\n\n') + 1), texts[i], vkey);
    } else {
      assert.equal(raced[i].status, 409);
      assert.equal(raced[i].headers.get('content-type'), 'text/x.tlog.size');
      assert.equal(texts[i], `${held}\n`);
    }
  }
  const monitor = await send(`/witness/${vectors.originHash}/checkpoint`);
  assert.equal(monitor.status, 200);
  assert.equal(Number((await monitor.text()).split('\n')[1]), held);
  return { vectors: vectors.steps.length, successful, concurrent_requests: raced.length, held };
}
