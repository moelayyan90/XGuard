import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify } from 'node:crypto';
import { parseCheckpointNote, verifyConsistency, unb64Strict, PINNED_LOGS, PRODUCTION_WITNESS_KEY } from '../apps/relay/src/c2sp-witness.js';
import { parseConsistencyPayload, verifyCosignature } from '../apps/relay/test/c2sp-interop-helpers.mjs';

export const GBLIN_ORIGIN = 'gblin.digital/receipts-log';
export const GBLIN_HASH = createHash('sha256').update(GBLIN_ORIGIN).digest('hex');
export const MONITOR_URL = `https://api.xguardgate.com/witness/${GBLIN_HASH}/checkpoint`;
export const STATUS_URL = `https://api.xguardgate.com/witness/${GBLIN_HASH}/status`;

// Independent Node/OpenSSL verification of the log's note signature.
export function verifyPinnedLog(note) {
  const [name, id] = PINNED_LOGS[GBLIN_ORIGIN].vkey.split('+', 3);
  // The key payload itself can contain '+', so retain the complete suffix.
  const raw = Buffer.from(PINNED_LOGS[GBLIN_ORIGIN].vkey.slice(name.length + id.length + 2), 'base64');
  assert.equal(raw.length, 33); assert.equal(raw[0], 1);
  const hash = createHash('sha256').update(name + '\n').update(raw).digest().subarray(0, 4);
  assert.equal(hash.toString('hex'), id);
  const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw.subarray(1)]), format: 'der', type: 'spki' });
  let good = false;
  for (const line of note.signatureLines) {
    if (!line.startsWith('— ' + name + ' ')) continue;
    const sig = Buffer.from(line.slice(name.length + 3), 'base64');
    if (!sig.subarray(0, 4).equals(hash)) continue;
    assert.equal(sig.length, 68); assert.equal(verify(null, Buffer.from(note.body), key, sig.subarray(4)), true); good = true;
  }
  assert.equal(good, true, 'pinned GBLIN signature required'); return true;
}
function signedAt(line) { return new Date(Number(Buffer.from(line.split(' ').at(-1), 'base64').readBigUInt64BE(4)) * 1000).toISOString(); }
function inspectCheckpoint(raw, witnessKey) {
  const note = parseCheckpointNote(raw); assert.equal(note.origin, GBLIN_ORIGIN); verifyPinnedLog(note);
  const line = note.signatureLines.find(x => x.startsWith('— xguardgate.com/witness '));
  assert.ok(line, 'XGuard cosignature required'); verifyCosignature(note.body, line, witnessKey);
  return { size: note.size, root: Buffer.from(note.root).toString('base64'), note, cosignature: line, cosigned_at: signedAt(line) };
}

export async function auditStability({ get, requireStatus = true, expectedKey = PRODUCTION_WITNESS_KEY, expectedTag } = {}) {
  const http = [];
  async function read(url, optional = false) {
    const response = await get(url);
    const reader = response.body?.getReader(), chunks = []; let length = 0;
    if (reader) while (true) { const { value, done } = await reader.read(); if(done)break; length += value.byteLength; if(length > 131072) { await reader.cancel(); throw Error('bounded public evidence'); } chunks.push(value); }
    const raw = reader ? new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks)) : '';
    const tag = response.headers.get('x-xguard-worker-version-tag');
    http.push({ url, status: response.status, content_type: response.headers.get('content-type'), response_date: response.headers.get('date'), worker_tag: tag });
    if (expectedTag && new URL(url).hostname === 'api.xguardgate.com') assert.equal(tag, expectedTag, 'candidate witness Worker tag');
    if (optional && response.status === 404) return null;
    assert.equal(response.status, 200, url); assert.ok(raw.length <= 131072, 'bounded public evidence');
    return { raw, type: response.headers.get('content-type') };
  }
  const metadata = JSON.parse((await read('https://api.xguardgate.com/witness')).raw);
  const key = (await read('https://api.xguardgate.com/witness/verifier-key')).raw.trim();
  assert.equal(metadata.verifier_key, expectedKey, 'production witness identity is pinned'); assert.equal(key, expectedKey);
  if(requireStatus)assert.equal(metadata.identity_policy,'pinned_existing_production_key','deployed identity policy must fail closed');
  assert.ok(metadata.accepted_logs.some(x => x.origin === GBLIN_ORIGIN && x.verifier_key === PINNED_LOGS[GBLIN_ORIGIN].vkey));
  const upstream = await read('https://mcp.gblin.digital/log/checkpoint'), monitored = await read(MONITOR_URL);
  const direct = inspectCheckpoint(upstream.raw, key), held = inspectCheckpoint(monitored.raw, key);
  const roster = JSON.parse((await read('https://mcp.gblin.digital/log/witnesses')).raw);
  const push = roster.witnesses.find(x => x.witness === 'xguardgate.com/witness'); assert.ok(push);
  assert.equal(push.vkey, key); assert.equal(push.endpoint, 'https://api.xguardgate.com/witness/add-checkpoint');
  assert.equal(push.last_error, null, 'GBLIN current witness push error'); assert.ok(Number.isFinite(Date.parse(push.at)));
  assert.equal(push.cosigned_size, direct.size); assert.equal(held.size, direct.size, 'XGuard must not lag GBLIN'); assert.equal(held.root, direct.root);
  const statusResponse = await read(STATUS_URL, !requireStatus), status = statusResponse ? JSON.parse(statusResponse.raw) : null;
  const growth = status?.recent_growth || [];
  if (status) {
    assert.equal(status.verifier_key, key); assert.equal(status.size, held.size); assert.equal(status.root, held.root); assert.equal(status.storage_read, 'ok');
    assert.ok(Array.isArray(growth) && growth.length <= 32);
    for (let i = 0; i < growth.length; i++) {
      const e = growth[i], note = parseCheckpointNote(e.signed_body + '\n' + e.cosignature + '\n');
      assert.equal(note.origin, GBLIN_ORIGIN); assert.equal(note.size, e.size); assert.equal(Buffer.from(note.root).toString('base64'), e.root);
      assert.ok(e.size > e.old_size); if(i) assert.equal(e.old_size, growth[i - 1].size);
      assert.ok(Number.isFinite(Date.parse(e.accepted_at))); verifyCosignature(e.signed_body, e.cosignature, key);
    }
    if (growth.length) { assert.equal(growth.at(-1).size, held.size); assert.equal(growth.at(-1).root, held.root); }
  }
  // Distinguish append-only log growth from evidence of individual deliveries.
  // A consistency proof for 213 does NOT prove that XGuard received size 213.
  const logGrowth = [];
  if (direct.size >= 214) {
    let priorRoot;
    for (const [old, next] of [[212, 213], [213, direct.size]]) {
      const response = await read(`https://mcp.gblin.digital/log/consistency?old=${old}&new=${next}`);
      const payload = JSON.parse(response.raw), expectedNew = next === direct.size ? direct.root : payload.new_root;
      if (priorRoot) assert.equal(payload.old_root, priorRoot);
      const proof = parseConsistencyPayload(response.raw, response.type, { origin: GBLIN_ORIGIN, old, new: next, oldRoot: payload.old_root, newRoot: expectedNew }).map(unb64Strict);
      assert.equal(await verifyConsistency(old, next, unb64Strict(payload.old_root), unb64Strict(expectedNew), proof), true);
      logGrowth.push({ old, size: next, old_root: payload.old_root, root: expectedNew, consistency_verified: true }); priorRoot = expectedNew;
    }
  }
  const observed = growth.filter(e => e.old_size >= 212 && e.size > 212);
  return { observed_at: new Date().toISOString(), result: 'passed', mode: 'GET-only; no checkpoint submission or financial request', http,
    verifier_key: key, production_identity_policy:metadata.identity_policy||'legacy_unspecified', gblin_verifier_key: PINNED_LOGS[GBLIN_ORIGIN].vkey, latest_size: direct.size, latest_root: direct.root,
    gblin_push_record: push, gblin_checkpoint_cosignature_at: direct.cosigned_at, xguard_monitor_cosignature_at: held.cosigned_at,
    log_signature_verified_independently: true, xguard_cosignatures_verified_independently: true, monitor_size_root_match: true, current_push_error: push.last_error,
    monitored_note: monitored.raw, upstream_note: upstream.raw, log_only_growth: logGrowth, history_status: status,
    observed_distinct_growth_sizes_after_212: observed.map(x => x.size), several_witness_growth_events_proven: observed.length >= 2,
    history_limit: 'Only recorded successful growth is counted. Historical deliveries such as 213 cannot be inferred from the current head or our own replay probes.',
    sender_attribution: 'Pinned signatures authenticate checkpoints. The public GBLIN push state supplies operator-reported delivery status; HTTP sender identity is not independently authenticated.',
    financial_settlements_submitted: 0, canary_route: null, canary_fixture: null, reverse_proofrail_c2sp_feed_claimed: false };
}
