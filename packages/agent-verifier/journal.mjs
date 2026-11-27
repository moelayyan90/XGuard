import { closeSync, openSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { nowSeconds, reviewOffer } from './verify.mjs';

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
    CREATE INDEX IF NOT EXISTS spend_window ON approvals(network, asset, used_at);`);
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

    if (action === 'approve') {
      if (!old) db.prepare(`INSERT INTO approvals
        (operation, request_hash, offer_hash, terms_hash, network, asset, amount)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(operation, offer.requestHash, offer.offerHash,
          offer.termsHash, offer.network, offer.asset, offer.amountAtomic);
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
    return { ...offer, operation, status: action === 'approve' ? 'approved' : 'consumed' };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
