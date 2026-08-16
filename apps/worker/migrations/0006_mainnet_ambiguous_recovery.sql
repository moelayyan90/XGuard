CREATE TABLE settlement_recovery_jobs (
  logical_payment_key TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  expected_payer TEXT NOT NULL,
  expected_pay_to TEXT NOT NULL,
  expected_amount_micro_usd INTEGER NOT NULL CHECK (
    expected_amount_micro_usd > 0 AND expected_amount_micro_usd <= 9007199254740991
  ),
  authorization_nonce TEXT NOT NULL,
  valid_before_epoch INTEGER NOT NULL CHECK (valid_before_epoch > 0),
  from_block INTEGER,
  state TEXT NOT NULL CHECK (state IN ('PENDING','CONFIRMED','CANCELED','EXPIRED')),
  transaction_hash TEXT,
  result_json TEXT,
  attempts INTEGER NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  last_error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX settlement_recovery_pending_idx
  ON settlement_recovery_jobs(state, updated_at);
