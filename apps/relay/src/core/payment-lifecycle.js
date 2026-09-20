export const EXECUTION_STATES = Object.freeze({
  DISCOVERED: ["QUOTED", "REJECTED"], QUOTED: ["PAYMENT_REQUIRED", "EXPIRED", "REJECTED"],
  PAYMENT_REQUIRED: ["PAYMENT_PRESENTED", "EXPIRED", "REJECTED"], PAYMENT_PRESENTED: ["VERIFIED", "REJECTED", "EXPIRED", "REPLAYED"],
  VERIFIED: ["SETTLEMENT_RESERVED", "REJECTED"], SETTLEMENT_RESERVED: ["SETTLEMENT_PENDING", "SETTLEMENT_AMBIGUOUS"],
  SETTLEMENT_PENDING: ["SETTLED", "SETTLEMENT_AMBIGUOUS", "REJECTED"], SETTLEMENT_AMBIGUOUS: ["RECONCILIATION_REQUIRED"],
  RECONCILIATION_REQUIRED: ["SETTLED", "REJECTED"], SETTLED: ["EXECUTION_STARTED"],
  EXECUTION_STARTED: ["EXECUTED", "EXECUTION_FAILED_AFTER_SETTLEMENT"], EXECUTED: ["RECEIPT_ISSUED"],
  EXECUTION_FAILED_AFTER_SETTLEMENT: ["RECOVERY_CREDIT_ISSUED"], RECOVERY_CREDIT_ISSUED: ["EXECUTION_STARTED"],
  RECEIPT_ISSUED: [], REJECTED: [], EXPIRED: [], REPLAYED: [],
});
export function advanceLifecycle(record, next, now = Date.now()) {
  if (record.lifecycle_version !== 1) return record; // Historical durable records retain their financial contract.
  if (record.lifecycle_state === next) return record;
  if (!EXECUTION_STATES[record.lifecycle_state]?.includes(next)) throw new Error("invalid_execution_lifecycle_transition");
  const event = { sequence: (record.lifecycle_sequence || 0) + 1, state: next, at: new Date(now).toISOString(), correlation_id: record.request_id };
  return { ...record, lifecycle_state: next, lifecycle_sequence: event.sequence, lifecycle_events: [...(record.lifecycle_events || []), event] };
}
export function financialLifecycle(record, next) {
  if (record.lifecycle_version !== 1) return record;
  if (next === "verified") return advanceLifecycle(record, "VERIFIED");
  if (next === "settled") return advanceLifecycle(record, "SETTLED");
  if (next === "failed") return advanceLifecycle(record, "REJECTED");
  if (next === "ambiguous") {
    if (record.lifecycle_state === "RECONCILIATION_REQUIRED") return record;
    return advanceLifecycle(advanceLifecycle(record, "SETTLEMENT_AMBIGUOUS"), "RECONCILIATION_REQUIRED");
  }
  if (next === "credited") return advanceLifecycle(advanceLifecycle(record, "EXECUTION_FAILED_AFTER_SETTLEMENT"), "RECOVERY_CREDIT_ISSUED");
  if (next === "succeeded") return advanceLifecycle(advanceLifecycle(record, "EXECUTED"), "RECEIPT_ISSUED");
  return record;
}
