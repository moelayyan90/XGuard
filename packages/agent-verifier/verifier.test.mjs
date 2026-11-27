import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { fixture } from './fixtures.mjs';
import { loadPolicy, reviewOffer, reviewReceipt } from './verify.mjs';
import { openJournal, recordDecision } from './journal.mjs';

const call = promisify(execFile);
const cli = fileURLToPath(new URL('./cli.mjs', import.meta.url));
const instant = 1800000000;
const clock = () => instant;
const artifact = input => input.challenge.extensions['offer-receipt'].info;

test('one local policy accepts two independently keyed merchant origins', () => {
  const a = fixture('books.example', instant), b = fixture('tools.example', instant);
  const policy = loadPolicy({ ...a.policy, resources: [...a.policy.resources, ...b.policy.resources] });
  for (const merchant of [a, b]) {
    assert.equal(reviewOffer(policy, merchant.offerInput, instant).amountAtomic, '1000');
    assert.equal(reviewReceipt(policy, merchant.receiptInput, instant).status, 'merchant_receipt_verified');
  }
  assert.throws(() => reviewOffer(loadPolicy(a.policy), b.offerInput, instant), /resource_not_in_policy/);
});

test('a matching key identifier cannot substitute a key from another issuer', () => {
  const a = fixture('books.example', instant), b = fixture('books.example', instant);
  artifact(a.offerInput).offers = [b.signed(a.offer)];
  assert.throws(() => reviewOffer(loadPolicy(a.policy), a.offerInput, instant), /invalid_signature/);
  artifact(a.offerInput).offers = [a.signed(a.offer, { jku: 'https://untrusted.example/keys' })];
  assert.throws(() => reviewOffer(loadPolicy(a.policy), a.offerInput, instant), /untrusted_signer_or_header/);
});

test('unsigned routing hints cannot override signed terms or select another option', () => {
  for (const change of [
    x => { x.challenge.accepts[0].amount = '20'; },
    x => { x.challenge.accepts[0].payTo = '0x' + '90'.repeat(20); },
    x => { x.challenge.accepts[0].network = 'eip155:1'; },
    x => { x.challenge.accepts.push(x.challenge.accepts[0]); },
    x => { artifact(x).offers[0].acceptIndex = 1; },
    x => { artifact(x).offers = []; },
    x => { x.challenge.resource.url += '/different'; },
  ]) {
    const f = fixture('books.example', instant);
    change(f.offerInput);
    assert.throws(() => reviewOffer(loadPolicy(f.policy), f.offerInput, instant));
  }
});

test('cap and expiry reject enormous values, noninteger encodings and expired offers', () => {
  const f = fixture('books.example', instant);
  const policy = loadPolicy(f.policy);
  assert.throws(() => reviewOffer(policy, f.offerInput, instant + 300), /expired_or_undated_offer/);
  for (const amount of ['1001', '01', '1.0', '1e3', '-1', '9'.repeat(79)]) {
    f.offerInput.challenge.accepts[0].amount = amount;
    artifact(f.offerInput).offers = [f.signed({ ...f.offer, amount })];
    assert.throws(() => reviewOffer(policy, f.offerInput, instant), /atomic_amount|per_call_cap/);
  }
});

test('operator approval binds exact request body, method, signed offer and wire option', () => {
  const f = fixture('books.example', instant), policy = loadPolicy(f.policy);
  const db = openJournal(':memory:');
  try {
    const record = (action, input) => recordDecision(db, action, policy, 'operation-1', input, clock);
    assert.throws(() => record('consume', f.offerInput), /approval_required/);
    const first = record('approve', f.offerInput);
    assert.deepEqual(record('approve', f.offerInput), first);
    for (const change of [
      x => { x.request.body += ' '; },
      x => { x.request.method = 'GET'; x.request.body = ''; },
      x => { artifact(x).offers = [f.signed({ ...f.offer, validUntil: instant + 600 })]; },
      x => { x.challenge.accepts[0].extra = { changed: true }; },
    ]) {
      const altered = structuredClone(f.offerInput);
      change(altered);
      assert.throws(() => record('consume', altered), /approval_binding_mismatch/);
    }
    assert.throws(() => recordDecision(db, 'consume', policy, 'operation-1', f.offerInput,
      () => instant + 300), /expired_or_undated_offer/);
    assert.equal(record('consume', f.offerInput).status, 'consumed');
    assert.throws(() => record('approve', f.offerInput), /approval_already_consumed/);
  } finally { db.close(); }
});

test('rolling 24h budget is shared across merchants and released at the exact boundary', () => {
  const a = fixture('books.example', instant), b = fixture('tools.example', instant);
  const policy = loadPolicy({ ...a.policy, resources: [...a.policy.resources, ...b.policy.resources] });
  const db = openJournal(':memory:');
  try {
    artifact(b.offerInput).offers = [b.signed({ ...b.offer, validUntil: instant + 87000 })];
    for (const action of ['approve', 'consume']) recordDecision(db, action, policy, 'operation-a', a.offerInput, clock);
    recordDecision(db, 'approve', policy, 'operation-b', b.offerInput, clock);
    assert.throws(() => recordDecision(db, 'consume', policy, 'operation-b', b.offerInput,
      () => instant + 86399), /rolling_cap_exceeded/);
    assert.equal(recordDecision(db, 'consume', policy, 'operation-b', b.offerInput,
      () => instant + 86400).status, 'consumed');
  } finally { db.close(); }
});

test('fresh processes sharing one journal can consume an approval only once', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'open-verifier-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const f = fixture();
  const args = [join(dir, 'policy.json'), join(dir, 'offer.json'), join(dir, 'approvals.sqlite'), 'same-operation'];
  await Promise.all([writeFile(args[0], JSON.stringify(f.policy)), writeFile(args[1], JSON.stringify(f.offerInput))]);
  await call(process.execPath, [cli, 'approve', ...args]);
  const runs = await Promise.allSettled([1, 2].map(() => call(process.execPath, [cli, 'consume', ...args])));
  assert.equal(runs.filter(r => r.status === 'fulfilled').length, 1);
  assert.match(runs.find(r => r.status === 'rejected').reason.stderr, /approval_already_consumed/);
  await assert.rejects(call(process.execPath, [cli, 'consume', ...args]), e => e.stderr.includes('approval_already_consumed'));
});

test('receipt binds independent payer, transaction, resource, settlement and time window', () => {
  const f = fixture('books.example', instant);
  const policy = loadPolicy(f.policy);
  for (const change of [
    x => { x.expected.transaction = '0x' + 'ed'.repeat(32); },
    x => { x.expected.payer = '0x' + 'ed'.repeat(20); },
    x => { x.settlement.success = false; },
    x => { x.settlement.network = 'eip155:1'; },
    x => { x.expected.notBefore = instant + 1; },
  ]) {
    const input = structuredClone(f.receiptInput);
    change(input);
    assert.throws(() => reviewReceipt(policy, input, instant));
  }
  for (const update of [{ issuedAt: instant - 31 }, { issuedAt: instant + 1 },
    { transaction: undefined }, { payer: '0x' + 'ed'.repeat(20) },
    { resourceUrl: 'https://other.example/records' }]) {
    const input = structuredClone(f.receiptInput);
    input.settlement.extensions['offer-receipt'].info.receipt = f.signed({ ...f.receipt, ...update });
    assert.throws(() => reviewReceipt(policy, input, instant));
  }
});
