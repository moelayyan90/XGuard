// Standalone host interoperability exercise. Both agents get public fixtures only.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { fixture } from '../../../packages/agent-verifier/fixtures.mjs';
import { openJournal, recordDecision, reconcileReceipt } from '../../../packages/agent-verifier/journal.mjs';
import { signApprovedOffer } from '../../../packages/agent-verifier/signer.mjs';
import { loadPolicy, nowSeconds, reviewReceipt } from '../../../packages/agent-verifier/verify.mjs';

const exec = promisify(execFile);
const folder = fileURLToPath(new URL('../../../packages/agent-verifier/', import.meta.url));
const [host, executable] = process.argv.slice(2);
if (!['goose', 'pydantic-ai'].includes(host)) throw new Error('Select goose or pydantic-ai');
const dir = await mkdtemp(join(tmpdir(), 'verifier-host-'));
const account = privateKeyToAccount(generatePrivateKey());
const db = openJournal(join(dir, 'journal.sqlite'));
try {
  const f = fixture('books.example', nowSeconds(), account.address);
  f.policy.signing = { payer: account.address, tokenName: 'Fixture USD', tokenVersion: '2', maxValiditySeconds: 45 };
  const policy = loadPolicy(f.policy);
  const policyFile = join(dir, 'policy.json'), sampleFile = join(dir, 'public-input.json');
  await writeFile(policyFile, JSON.stringify(f.policy), { mode: 0o600 });
  await writeFile(sampleFile, JSON.stringify({ policy: f.policy, offerInput: f.offerInput, receiptInput: f.receiptInput }),
    { mode: 0o600 });
  const operation = 'host-sample';
  recordDecision(db, 'approve', policy, operation, f.offerInput);
  const { stdout } = host === 'goose'
    ? await exec(process.execPath, [join(folder, 'goose-smoke.mjs'), executable || 'goose', sampleFile], { timeout: 60000 })
    : await exec(executable || 'python3', [join(folder, 'conformance/pydantic_host.py'), sampleFile, policyFile],
      { timeout: 60000, env: { PATH: process.env.PATH, HOME: dir, OTEL_SDK_DISABLED: 'true' } });
  const review = JSON.parse(stdout);
  assert.equal(review.receipt.receiptHash, reviewReceipt(policy, f.receiptInput).receiptHash);
  let signedData, calls = 0;
  const wallet = { address: account.address, async signTypedData(data) {
    calls++;
    signedData = data;
    return account.signTypedData(data);
  } };
  const options = { db, policy, operation, input: f.offerInput, review: review.offer, wallet };
  const signed = await signApprovedOffer(options);
  const { signature, authorization } = signed.paymentPayload.payload;
  assert.equal((await recoverTypedDataAddress({ ...signedData, signature })).toLowerCase(), account.address.toLowerCase());
  assert.equal(authorization.to, f.policy.resources[0].payTo);
  assert.equal(authorization.value, f.offer.amount);
  assert.deepEqual(signed.request, f.offerInput.request);
  await assert.rejects(signApprovedOffer(options), /approval_already_consumed/);
  assert.equal(calls, 1);
  // A separate simulated merchant attestation issued after consumption. No RPC or transfer.
  f.receiptInput.settlement.extensions['offer-receipt'].info.receipt = f.signed({ ...f.receipt, issuedAt: nowSeconds() });
  const reconciliation = reconcileReceipt(db, policy, operation, f.offerInput.request, f.receiptInput);
  assert.equal(reconciliation.status, 'merchant_receipt_reconciled');
  console.log(JSON.stringify({ host, discoveredTools: 2, recoveredFixtureSignatures: calls,
    replay: 'approval_already_consumed', receipt: reconciliation.status, networkPayments: 0 }));
} finally {
  db.close();
  await rm(dir, { recursive: true, force: true });
}
