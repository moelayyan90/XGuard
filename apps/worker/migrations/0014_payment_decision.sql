-- Buyer/agent-side XGuard payment decisions and independent transaction records.
-- The offer surface is deliberately not stored and never billable.

CREATE TABLE IF NOT EXISTS payment_decision_records (
  decision_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE,
  principal_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  offer_id TEXT,
  channel TEXT NOT NULL CHECK(channel IN ('browser','agent','api')),
  rail TEXT NOT NULL,
  provider TEXT NOT NULL,
  amount TEXT NOT NULL,
  currency TEXT NOT NULL,
  payee TEXT NOT NULL,
  merchant_origin TEXT,
  network TEXT,
  asset TEXT,
  payment_reference TEXT,
  decision TEXT NOT NULL CHECK(decision IN ('ALLOW','REVIEW','BLOCK')),
  risk_score INTEGER NOT NULL CHECK(risk_score BETWEEN 0 AND 100),
  reason_codes_json TEXT NOT NULL,
  checks_json TEXT NOT NULL,
  fee_micro_usd INTEGER NOT NULL CHECK(fee_micro_usd > 0),
  decision_evidence_hash TEXT NOT NULL,
  receipt_json TEXT NOT NULL,
  billing_state TEXT NOT NULL CHECK(billing_state IN ('HELD','EARNED')),
  settlement_status TEXT NOT NULL DEFAULT 'NOT_EXECUTED'
    CHECK(settlement_status IN ('NOT_EXECUTED','SETTLED','FAILED','CANCELLED','UNKNOWN')),
  provider_transaction_id TEXT,
  settled_amount TEXT,
  settled_at TEXT,
  settlement_evidence_hash TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(principal_id, request_id)
);

CREATE INDEX IF NOT EXISTS payment_decision_records_principal_created
  ON payment_decision_records(principal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS payment_decision_records_reference
  ON payment_decision_records(principal_id, payment_reference, settlement_status)
  WHERE payment_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS payment_decision_records_provider_tx
  ON payment_decision_records(principal_id, provider_transaction_id)
  WHERE provider_transaction_id IS NOT NULL;
