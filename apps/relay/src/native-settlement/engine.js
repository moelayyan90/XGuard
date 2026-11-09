import { NativePaymentVerifier } from './verifier.js';
import { buildSettlementTransaction } from './transaction.js';
import { ConfirmationTracker } from './confirmation.js';
import { BASE_NETWORK, NATIVE_STATUS, SettlementError, inspectNative, requireThat } from './policy.js';
import { TERMINAL } from './repository.js';
const pending = record => ({ success: false, errorReason: 'settlement_pending', transaction: record?.hash || '', network: BASE_NETWORK, state: record?.state || 'UNKNOWN' });
export class NativeSettlementEngine {
  constructor({ repository, rpc, signer, mode = 'disabled' }) {
    this.repository = repository; this.rpc = rpc; this.signer = signer; this.mode = mode;
    this.verifier = new NativePaymentVerifier(rpc); this.confirmations = new ConfirmationTracker(rpc);
  }
  status() { return NATIVE_STATUS; }
  async verify(payment, requirements) {
    const { isValid, invalidReason, payer } = await this.verifier.verify(payment, requirements);
    return { isValid, ...(invalidReason ? { invalidReason } : {}), ...(payer ? { payer } : {}) };
  }
  async settle(payment, requirements, idempotencyKey) {
    const started = performance.now(); let owned;
    try {
      requireThat(this.mode === 'simulation' && this.rpc?.isSimulation === true && this.signer?.isSimulation === true, 'native_settlement_disabled', 503);
      requireThat(typeof idempotencyKey === 'string' && /^[A-Za-z0-9_.:-]{8,128}$/.test(idempotencyKey), 'invalid_idempotency_key');
      // Identity remains readable after expiry for recovery of a payment that
      // was already sent. Only fresh verification may admit a new settlement.
      const inspected = inspectNative(payment, requirements, { checkTime: false });
      if (!this.repository.get(inspected.authorizationKey)) {
        const precheck = await this.verifier.verify(payment, requirements);
        if (!precheck.isValid) return { success: false, errorReason: precheck.invalidReason, network: BASE_NETWORK, transaction: '' };
      }
      owned = this.repository.claim(inspected, idempotencyKey);
      if (owned.record.state === 'CONFIRMED') return owned.record.receipt;
      if (TERMINAL.has(owned.record.state)) return { success: false, errorReason: owned.record.reason || 'settlement_rejected', network: BASE_NETWORK, transaction: owned.record.hash || '' };
      if (!owned.acquired) return pending(owned.record);
      let record = owned.record; const key = inspected.authorizationKey;
      if (record.hash && ['SUBMITTING', 'BROADCAST', 'CONFIRMING', 'UNKNOWN'].includes(record.state)) return await this.reconcileOwned(record, owned.owner);
      const verification = await this.verifier.verify(payment, requirements);
      if (!verification.isValid) {
        this.repository.transition(key, owned.owner, ['RESERVED','PREPARING','PREPARED'], { state: verification.retryable ? record.state : 'REJECTED', reason: verification.invalidReason, leaseUntil: 0 });
        return { success: false, errorReason: verification.invalidReason, network: BASE_NETWORK, transaction: '' };
      }
      inspected.signature = payment.payload.signature;
      const intent = buildSettlementTransaction(inspected);
      if (record.state === 'RESERVED') {
        const quoted = await this.signer.quote(intent), nonce = await this.rpc.getTransactionCount(this.signer.address);
        record = this.repository.prepare(key, owned.owner, quoted, this.signer.address, nonce);
      }
      if (record.state === 'PREPARING') {
        const signed = await this.signer.sign(record.unsigned, intent.data);
        record = this.repository.transition(key, owned.owner, ['PREPARING'], { state: 'PREPARED', raw: signed.raw, hash: signed.hash, authorization: inspected.auth });
      }
      // Persist the deterministic hash and exact signed bytes BEFORE broadcast.
      // An interrupted broadcast can only reconcile this transaction. No path
      // creates a replacement payment or switches to an upstream facilitator.
      record = this.repository.transition(key, owned.owner, ['PREPARED'], { state: 'SUBMITTING' });
      try {
        const hash = await this.rpc.broadcastRawTransaction(record.raw);
        requireThat(hash.toLowerCase() === record.hash.toLowerCase(), 'rpc_broadcast_hash_mismatch', 503);
        record = this.repository.transition(key, owned.owner, ['SUBMITTING'], { state: 'BROADCAST' });
      } catch {
        record = this.repository.transition(key, owned.owner, ['SUBMITTING'], { state: 'UNKNOWN', reason: 'broadcast_outcome_unknown', leaseUntil: 0 });
        return pending(record);
      }
      return await this.reconcileOwned(record, owned.owner);
    } catch (error) {
      // A failed persistence boundary never releases an authorization for reuse.
      return { success: false, errorReason: error instanceof SettlementError ? error.code : 'native_internal_or_storage_failure', transaction: owned?.record?.hash || '', network: BASE_NETWORK };
    } finally {
      console.log(JSON.stringify({ event: 'native_simulation_attempt', mode: this.mode, latency_ms: Math.round(performance.now() - started), production_money_moved: false }));
    }
  }
  async reconcileOwned(record, owner) {
    if (record.nextCheck > Date.now() || record.reconciliationAttempts >= 10) {
      this.repository.transition(record.authorizationKey, owner, [record.state], { leaseUntil: 0 });
      return pending(record);
    }
    let outcome;
    try { outcome = await this.confirmations.check(record); }
    catch { outcome = { state: 'UNKNOWN', reason: 'confirmation_rpc_failure' }; }
    const attempts = record.reconciliationAttempts + 1;
    const updated = this.repository.transition(record.authorizationKey, owner, [record.state], { ...outcome, reconciliationAttempts: attempts, nextCheck: Date.now() + Math.min(600000, 1000 * 2 ** attempts), leaseUntil: 0 });
    if (updated.state === 'CONFIRMED') return updated.receipt;
    if (TERMINAL.has(updated.state)) return { success: false, errorReason: updated.reason, transaction: updated.hash, network: BASE_NETWORK };
    return pending(updated);
  }
}
