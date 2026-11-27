import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './fixtures.mjs';
import { openJournal, recordDecision, reconcileReceipt } from './journal.mjs';
import { signApprovedOffer } from './signer.mjs';
import { loadPolicy, reviewOffer } from './verify.mjs';

const instant = 1800000000;
const operation = 'example-0001';
function context(t) {
  const f = fixture('shops.example', instant);
  f.policy.signing = { payer: f.receipt.payer, tokenName: 'Fixture USD', tokenVersion: '2', maxValiditySeconds: 30 };
  const policy = loadPolicy(f.policy), db = openJournal(':memory:');
  t.after(() => db.close());
  const clock = () => instant;
  const approve = (p = policy, id = operation) => recordDecision(db, 'approve', p, id, f.offerInput, clock);
  const review = () => reviewOffer(policy, f.offerInput, instant);
  const wallet = { address: f.receipt.payer, async signTypedData() { throw new Error('wallet_stopped'); } };
  const sign = (options = {}) => signApprovedOffer({ db, policy, clock, wallet, operation, input: f.offerInput,
    review: review(), ...options });
  const consume = (id = operation) => recordDecision(db, 'consume', policy, id, f.offerInput, clock);
  const reconcile = (id = operation) => reconcileReceipt(db, policy, id, f.offerInput.request, f.receiptInput, instant);
  return { f, db, policy, wallet, approve, review, sign, consume, reconcile };
}

test('missing approval, mismatched review and unsigned signing metadata cannot reach a wallet', async t => {
  const { f, approve, sign, review } = context(t);
  await assert.rejects(sign(), /approval_required/);
  approve();
  await assert.rejects(sign({ review: { ...review(), termsHash: 'bad' } }), /host_review_mismatch/);
  for (const extra of [{ name: 'Changed', version: '2' }, { name: 'Fixture USD', version: '1' },
    { name: 'Fixture USD', version: '2', assetTransferMethod: 'permit2' },
    { name: 'Fixture USD', version: '2', feePayer: true }]) {
    f.offerInput.challenge.accepts[0].extra = extra;
    await assert.rejects(sign(), /unsupported_signing_terms/);
  }
});

test('operator permission binds payer and token domain and cannot be upgraded from a legacy approval', async t => {
  const { f, approve, sign, policy } = context(t);
  const legacy = { ...policy, signing: undefined };
  approve(legacy);
  await assert.rejects(sign(), /signing_policy_changed/);
  approve(policy, 'example-0002');
  const changed = loadPolicy({ ...f.policy, signing: { ...f.policy.signing, maxValiditySeconds: 60 } });
  await assert.rejects(sign({ operation: 'example-0002', policy: changed }), /signing_policy_changed/);
  await assert.rejects(sign({ wallet: { address: f.offer.payTo, signTypedData() {} } }), /configured_wallet_required/);
});

test('a failed or slow signer consumes the original permission permanently', async t => {
  const { approve, sign, wallet } = context(t);
  approve();
  await assert.rejects(sign(), /wallet_stopped/);
  await assert.rejects(sign(), /approval_already_consumed/);
  // Use a separate journal and budget for a delayed signature.
  const next = context(t);
  next.approve();
  let now = instant;
  await assert.rejects(next.sign({ clock: () => now, wallet: { ...wallet, async signTypedData() {
    now += 30;
    return '0x' + '00'.repeat(65);
  } } }), /authorization_expired_after_signing/);
  await assert.rejects(next.sign(), /approval_already_consumed/);
});

test('reconciliation is idempotent, binds the consumed body and prevents reuse of a transaction', t => {
  const { f, db, policy, approve, consume, reconcile } = context(t);
  const rules = loadPolicy({ ...f.policy, maxPer24hAtomic: '3000' });
  approve();
  assert.throws(reconcile, /consumed_approval_required/);
  consume();
  const result = reconcile();
  assert.deepEqual(reconcile(), result);
  assert.throws(() => reconcileReceipt(db, policy, operation, { ...f.offerInput.request, body: 'changed' },
    f.receiptInput, instant), /receipt_operation_mismatch/);
  for (const action of ['approve', 'consume']) recordDecision(db, action, rules, 'example-0002', f.offerInput, () => instant);
  assert.throws(() => reconcile('example-0002'), /receipt_binding_conflict/);
  const prior = structuredClone(f.receiptInput);
  prior.settlement.extensions['offer-receipt'].info.receipt = f.signed({ ...f.receipt, issuedAt: instant - 1 });
  assert.throws(() => reconcileReceipt(db, policy, operation, f.offerInput.request, prior, instant), /receipt_operation_mismatch/);
});
