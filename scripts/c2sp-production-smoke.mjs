import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { parseCheckpointNote, verifyLogSignature, verifyConsistency, unb64Strict, PINNED_LOGS } from '../apps/relay/src/c2sp-witness.js';
import { verifyCosignature } from '../apps/relay/test/c2sp-interop-helpers.mjs';

const base = 'https://api.xguardgate.com';
const origin = 'gblin.digital/receipts-log';
const log = PINNED_LOGS[origin];
const hash = createHash('sha256').update(origin).digest('hex');
const monitorURL = `${base}/witness/${hash}/checkpoint`;
const submit = process.env.C2SP_SUBMIT_CHECKPOINT === 'true';
const evidence = { checked_at: new Date().toISOString(), repository_sha: process.env.GITHUB_SHA || null,
  mode: submit ? 'real-gblin-checkpoint' : 'read-only', monitor_url: monitorURL, payments_submitted: 0, checks: [] };
const get = (url, init = {}) => fetch(url, { ...init, redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'user-agent': 'XGuard-C2SP-Interop/1.0 (+https://github.com/moelayyan90/XGuard/issues/211)', 'cache-control': 'no-cache', ...init.headers } });

async function readHead(vkey) {
  const r = await get(monitorURL);
  if (r.status === 404) return null;
  assert.equal(r.status, 200, 'monitor endpoint');
  const raw = await r.text();
  const note = parseCheckpointNote(raw);
  assert.equal(note.origin, origin);
  assert.equal(await verifyLogSignature(note, log.vkey), true);
  const line = note.signatureLines.find(x => x.startsWith('— xguardgate.com/witness '));
  assert.ok(line, 'monitor must carry the XGuard cosignature');
  verifyCosignature(note.body, line, vkey);
  return { raw, note, line };
}

try {
  const metadataResponse = await get(`${base}/witness`);
  assert.equal(metadataResponse.status, 200, 'production witness metadata');
  const metadata = await metadataResponse.json();
  const keyResponse = await get(`${base}/witness/verifier-key`);
  assert.equal(keyResponse.status, 200);
  const vkey = (await keyResponse.text()).trim();
  assert.equal(vkey, metadata.verifier_key);
  assert.equal(metadata.witness, 'xguardgate.com/witness');
  assert.equal(metadata.push_endpoint, `${base}/witness/add-checkpoint`);
  assert.ok(metadata.accepted_logs.some(x => x.origin === origin && x.verifier_key === log.vkey && x.origin_hash === hash));
  assert.ok(!/privateJwk|private_key|"d"\s*:/.test(JSON.stringify(metadata)));
  evidence.metadata = metadata;
  evidence.verifier_key = vkey;
  console.log(JSON.stringify({ production_witness: metadata.witness, verifier_key: vkey, monitor: monitorURL }));

  for (const body of ['malformed\n', 'old -1\n\n', 'old 00\n\n', 'old +0\n\n']) {
    const r = await get(metadata.push_endpoint, { method: 'POST', body });
    assert.equal(r.status, 400, 'malformed production request');
    evidence.checks.push({ malformed: body.split('\n')[0], status: r.status });
  }
  const unknown = await get(`${base}/witness/${'ab'.repeat(32)}/checkpoint`);
  assert.equal(unknown.status, 404);
  evidence.checks.push({ unknown_monitoring_origin: 404 });

  let previous = await readHead(vkey);
  evidence.held_before = previous?.note.size ?? 0;
  const current = await get(log.checkpoint);
  assert.equal(current.status, 200, 'GBLIN public checkpoint');
  const realCheckpoint = await current.text();
  const note = parseCheckpointNote(realCheckpoint);
  assert.equal(note.origin, origin);
  assert.equal(await verifyLogSignature(note, log.vkey), true, 'real checkpoint must verify against the pinned GBLIN key');
  evidence.gblin_checkpoint = { size: note.size, root: Buffer.from(note.root).toString('base64'), note: realCheckpoint };
  const witnesses = await get('https://mcp.gblin.digital/log/witnesses');
  assert.equal(witnesses.status, 200);
  evidence.gblin_witnesses = await witnesses.json();

  if (submit) {
    let accepted = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const old = previous?.note.size ?? 0;
      assert.ok(note.size >= old, 'never send a rollback checkpoint');
      let proofText = '';
      let proof = [];
      if (old > 0 && old < note.size) {
        const r = await get(`https://mcp.gblin.digital/log/consistency?old=${old}&new=${note.size}`);
        assert.equal(r.status, 200, 'GBLIN consistency endpoint');
        const lines = (await r.text()).trim().split('\n').filter(Boolean);
        assert.ok(lines.length <= 63);
        proof = lines.map(unb64Strict);
        assert.ok(proof.every(x => x.length === 32));
        proofText = lines.join('\n') + '\n';
      }
      if (previous) assert.equal(await verifyConsistency(old, note.size, previous.note.root, note.root, proof), true, 'locally verify consistency before the real push');
      const response = await get(metadata.push_endpoint, { method: 'POST', body: `old ${old}\n${proofText}\n${realCheckpoint}` });
      const wire = await response.text();
      if (response.status === 409) { previous = await readHead(vkey); continue; }
      assert.equal(response.status, 200, `real checkpoint submission: ${wire}`);
      verifyCosignature(note.body, wire, vkey);
      const monitored = await readHead(vkey);
      assert.ok(monitored);
      assert.ok(monitored.note.size >= note.size);
      if (monitored.note.size === note.size) assert.deepEqual(monitored.note.root, note.root);
      evidence.cross_witnessing = { status: 200, submitted_by: 'XGuard production validation runner',
        log_signature_verified: true, consistency_verified: true, old_size: old, size: note.size,
        root: Buffer.from(note.root).toString('base64'), cosignature: wire.trim(), monitoring_verified: true,
        monitored_checkpoint: monitored.raw };
      accepted = true;
      break;
    }
    assert.equal(accepted, true, 'bounded checkpoint submission must complete');
  } else evidence.monitor_before = previous?.raw ?? null;

  const supported = await get(`${base}/supported`);
  assert.equal(supported.status, 200);
  const contract = await supported.json();
  assert.ok(contract.kinds.some(x => x.x402Version === 2 && x.scheme === 'exact' && x.network === 'eip155:8453'));
  evidence.supported = contract;
  for (const path of ['/verify', '/settle']) {
    const r = await get(base + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    assert.equal(r.status, 400, path + ' must fail before settlement with missing payment context');
    evidence.checks.push({ path, status: r.status, body: await r.json() });
  }
  // The current Live router intentionally retired the legacy /v1 readiness and
  // proof discovery URLs before this integration. Verify that exact contract
  // and require the actual active readiness endpoint to be healthy.
  for (const [path, expected] of [
    ['/.well-known/x402', 200], ['/v1/ready', 410], ['/v1/proof', 410],
    ['/healthz', 200], ['/api/paid/v1/readiness', 200],
    ['/.well-known/agent-card.json', 200], ['/openapi.json', 200],
  ]) {
    const r = await get(base + path);
    const raw = await r.text();
    evidence.checks.push({ path, status: r.status, expected, content_type: r.headers.get('content-type'), body: raw.slice(0, expected === 410 ? 180 : 1500) });
    assert.equal(r.status, expected, path);
  }
  const mcp = await get(base + '/mcp', { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 'gblin-c2sp-smoke', method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'XGuard-C2SP-smoke', version: '1.0' } } }) });
  assert.equal(mcp.status, 200);
  assert.match(await mcp.text(), /protocolVersion/);
  evidence.checks.push({ path: '/mcp', status: mcp.status, method: 'initialize' });
  const paid = await get(base + '/api/paid/v1/batch', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `c2sp-smoke-${crypto.randomUUID()}`, 'x-xguard-traffic-class': 'synthetic' },
    body: JSON.stringify({ facts: ['npm/react/latest-version'], max_amount_atomic: '10000' }) });
  assert.equal(paid.status, 402, 'paid route challenge readiness');
  assert.ok(paid.headers.get('payment-required'));
  evidence.checks.push({ paid_challenge: 402, payment_submitted: false });
  const repeatedKey = await get(`${base}/witness/verifier-key`);
  assert.equal((await repeatedKey.text()).trim(), vkey, 'production identity remains stable after signing');
  evidence.result = 'passed';
} catch (error) {
  evidence.result = 'failed';
  evidence.error = error.message;
  process.exitCode = 1;
} finally {
  writeFileSync('c2sp-production-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, '```json\n' + JSON.stringify(evidence, null, 2) + '\n```\n');
  console.log(JSON.stringify(evidence));
}
