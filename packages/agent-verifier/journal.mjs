import { closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { digest, hashRequest, nowSeconds, reviewOffer, reviewReceipt } from './verify.mjs';

// The caller owns the directory, the clock and the policy. No wallet secrets
// or request bodies are stored. SQLite serializes writers across processes.
export function openJournal(path) {
  if (path !== ':memory:') closeSync(openSync(path, 'a', 0o600));
  const db = new DatabaseSync(path);
  db.exec(`PRAGMA busy_timeout = 5000;
    CREATE TABLE IF NOT EXISTS approvals (
      operation TEXT PRIMARY KEY, request_hash TEXT NOT NULL, offer_hash TEXT NOT NULL,
      terms_hash TEXT NOT NULL, network TEXT NOT NULL, asset TEXT NOT NULL,
      amount TEXT NOT NULL, used_at INTEGER
    ) STRICT;
    CREATE INDEX IF NOT EXISTS spend_window ON approvals(network, asset, used_at);
    CREATE TABLE IF NOT EXISTS signing_policies (
      operation TEXT PRIMARY KEY, policy_hash TEXT NOT NULL, payer TEXT NOT NULL
    ) STRICT;
    CREATE TABLE IF NOT EXISTS reconciled_receipts (
      operation TEXT PRIMARY KEY, network TEXT NOT NULL, tx TEXT NOT NULL,
      payer TEXT NOT NULL, receipt_hash TEXT NOT NULL, UNIQUE(network, tx)
    ) STRICT;`);
  return db;
}

// Approval is an operator action. Consumption is a host action immediately
// before a separate signer. The MCP interface has access to neither function.
export function recordDecision(db, action, policy, operation, input, clock = nowSeconds) {
  if (!['approve', 'consume'].includes(action)) throw new Error('unknown_decision');
  if (typeof operation !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(operation))
    throw new Error('invalid_operation');
  db.exec('BEGIN IMMEDIATE');
  try {
    const now = clock(); // Check expiry after acquiring the writer lock.
    if (!Number.isSafeInteger(now) || now < 0) throw new Error('invalid_clock');
    const offer = reviewOffer(policy, input, now);
    const old = db.prepare('SELECT * FROM approvals WHERE operation = ?').get(operation);
    if (old && (old.request_hash !== offer.requestHash || old.offer_hash !== offer.offerHash ||
      old.terms_hash !== offer.termsHash)) throw new Error('approval_binding_mismatch');
    if (old && old.used_at !== null) throw new Error('approval_already_consumed');
    const signingHash = policy.signing && digest(JSON.stringify([policy.network, policy.asset,
      policy.signing.payer, policy.signing.tokenName, policy.signing.tokenVersion, policy.signing.maxValiditySeconds]));
    if (old && db.prepare('SELECT policy_hash FROM signing_policies WHERE operation = ?')
      .get(operation)?.policy_hash !== signingHash) throw new Error('signing_policy_changed');

    if (action === 'approve') {
      if (!old) db.prepare(`INSERT INTO approvals
        (operation, request_hash, offer_hash, terms_hash, network, asset, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(operation, offer.requestHash, offer.offerHash,
          offer.termsHash, offer.network, offer.asset, offer.amountAtomic);
      if (!old && signingHash) db.prepare('INSERT INTO signing_policies VALUES (?, ?, ?)')
        .run(operation, signingHash, policy.signing.payer);
    } else {
      if (!old) throw new Error('approval_required');
      const rows = db.prepare(`SELECT amount FROM approvals
        WHERE network = ? AND asset = ? AND used_at > ?`).iterate(offer.network, offer.asset, now - 86400);
      let total = BigInt(offer.amountAtomic);
      for (const row of rows) total += BigInt(row.amount);
      if (total > policy.maxPerDay) throw new Error('rolling_cap_exceeded');
      db.prepare('UPDATE approvals SET used_at = ? WHERE operation = ?').run(now, operation);
    }
    db.exec('COMMIT');
    return { ...offer, operation, ...(action === 'consume' && { consumedAt: now }),
      status: action === 'approve' ? 'approved' : 'consumed' };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

// The host supplies its original request and independently recorded payer and
// transaction. An offer may have expired by the time its receipt is available.
export function reconcileReceipt(db, policy, operation, request, input, now = nowSeconds()) {
  const receipt = reviewReceipt(policy, input, now);
  const { expected } = input;
  const payer = expected.payer.toLowerCase();
  const tx = expected.transaction.toLowerCase();
  db.exec('BEGIN IMMEDIATE');
  try {
    const spend = db.prepare(`SELECT a.*, s.payer AS signing_payer FROM approvals a
      LEFT JOIN signing_policies s USING(operation) WHERE operation = ?`).get(operation);
    if (!spend || spend.used_at === null) throw new Error('consumed_approval_required');
    if (spend.network !== receipt.network || spend.asset !== policy.asset ||
      spend.request_hash !== hashRequest(request) || expected.resourceUrl !== request.resourceUrl ||
      receipt.issuedAt < spend.used_at || (spend.signing_payer && spend.signing_payer !== payer))
      throw new Error('receipt_operation_mismatch');
    const prior = db.prepare('SELECT * FROM reconciled_receipts WHERE operation = ? OR (network = ? AND tx = ?)')
      .all(operation, receipt.network, tx);
    if (prior.some(row => row.operation !== operation || row.receipt_hash !== receipt.receiptHash ||
      row.tx !== tx || row.payer !== payer)) throw new Error('receipt_binding_conflict');
    if (!prior.length) db.prepare('INSERT INTO reconciled_receipts VALUES (?, ?, ?, ?, ?)')
      .run(operation, receipt.network, tx, payer, receipt.receiptHash);
    db.exec('COMMIT');
    return { status: 'merchant_receipt_reconciled', operation, transaction: tx, receiptHash: receipt.receiptHash };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
