import { SettlementError, stringify } from './policy.js';
export const TERMINAL = new Set(['CONFIRMED', 'REVERTED', 'QUARANTINED', 'REJECTED']);
export class SqliteSettlementRepository {
  constructor(storage) {
    this.storage = storage;
    storage.sql.exec('CREATE TABLE IF NOT EXISTS native_settlements(authorization_key TEXT PRIMARY KEY,idempotency_key TEXT UNIQUE NOT NULL,request_hash TEXT NOT NULL,record_json TEXT NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS native_signer_nonces(address TEXT PRIMARY KEY,next_nonce INTEGER NOT NULL)');
    storage.sql.exec('CREATE TABLE IF NOT EXISTS native_audit(sequence INTEGER PRIMARY KEY AUTOINCREMENT,authorization_key TEXT NOT NULL,state TEXT NOT NULL,at TEXT NOT NULL)');
    for (const action of ['UPDATE', 'DELETE']) storage.sql.exec(`CREATE TRIGGER IF NOT EXISTS native_audit_no_${action.toLowerCase()} BEFORE ${action} ON native_audit BEGIN SELECT RAISE(ABORT,'immutable_native_audit'); END`);
  }
  row(query, ...args) { return this.storage.sql.exec(query, ...args).toArray()[0]; }
  get(key) { const row = this.row('SELECT record_json FROM native_settlements WHERE authorization_key=?', key); return row ? JSON.parse(row.record_json) : null; }
  save(record) {
    this.storage.sql.exec('UPDATE native_settlements SET record_json=? WHERE authorization_key=?', stringify(record), record.authorizationKey);
    this.storage.sql.exec('INSERT INTO native_audit(authorization_key,state,at) VALUES(?,?,?)', record.authorizationKey, record.state, new Date().toISOString());
    return record;
  }
  claim({ authorizationKey, requestHash }, idempotencyKey) {
    return this.storage.transactionSync(() => {
      const indexed = this.row('SELECT authorization_key,request_hash FROM native_settlements WHERE idempotency_key=?', idempotencyKey);
      if (indexed && (indexed.request_hash !== requestHash || indexed.authorization_key !== authorizationKey)) throw new SettlementError('idempotency_conflict', 409);
      let record = this.get(authorizationKey);
      if (record && record.requestHash !== requestHash) throw new SettlementError('authorization_conflict', 409);
      if (record && record.idempotencyKey !== idempotencyKey) throw new SettlementError('authorization_replay', 409);
      if (record && (TERMINAL.has(record.state) || record.leaseUntil > Date.now())) return { record, acquired: false };
      const owner = crypto.randomUUID();
      if (!record) {
        record = { authorizationKey, requestHash, idempotencyKey, state: 'RESERVED', createdAt: new Date().toISOString(), reconciliationAttempts: 0 };
        this.storage.sql.exec('INSERT INTO native_settlements VALUES(?,?,?,?)', authorizationKey, idempotencyKey, requestHash, stringify(record));
      }
      record = this.save({ ...record, owner, leaseUntil: Date.now() + 30000 });
      return { record, acquired: true, owner };
    });
  }
  transition(key, owner, states, patch) {
    return this.storage.transactionSync(() => {
      const record = this.get(key);
      if (!record || record.owner !== owner || !states.includes(record.state)) throw new SettlementError('settlement_ownership_changed', 409);
      return this.save({ ...record, ...patch, updatedAt: new Date().toISOString() });
    });
  }
  prepare(key, owner, unsigned, signer, networkNonce) {
    return this.storage.transactionSync(() => {
      const record = this.get(key);
      if (record.owner !== owner || record.state !== 'RESERVED') throw new SettlementError('settlement_ownership_changed', 409);
      const next = this.row('SELECT next_nonce FROM native_signer_nonces WHERE address=?', signer.toLowerCase());
      const nonce = Math.max(Number(next?.next_nonce || 0), networkNonce);
      if (!Number.isSafeInteger(nonce) || nonce < 0) throw new SettlementError('invalid_signer_nonce');
      this.storage.sql.exec('INSERT INTO native_signer_nonces VALUES(?,?) ON CONFLICT(address) DO UPDATE SET next_nonce=excluded.next_nonce', signer.toLowerCase(), nonce + 1);
      return this.save({ ...record, state: 'PREPARING', signer, unsigned: { ...unsigned, nonce } });
    });
  }
}
