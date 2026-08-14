CREATE TABLE settlement_finality_jobs (
  logical_payment_key TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  transaction_hash TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  asset TEXT NOT NULL,
  expected_payer TEXT NOT NULL,
  expected_pay_to TEXT NOT NULL,
  expected_amount_micro_usd INTEGER NOT NULL CHECK (
    expected_amount_micro_usd > 0 AND expected_amount_micro_usd <= 9007199254740991
  ),
  settle_result_json TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('PENDING','CONFIRMED','FAILED','AMBIGUOUS')),
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  confirmed_at TEXT
);
CREATE INDEX settlement_finality_pending_idx ON settlement_finality_jobs(state, updated_at);
