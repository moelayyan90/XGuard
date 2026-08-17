CREATE TABLE zero_friction_accounts (
  pay_to TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(merchant_id),
  accrued_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (
    accrued_micro_usd >= 0 AND accrued_micro_usd <= 9007199254740991
  ),
  paid_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (
    paid_micro_usd >= 0 AND paid_micro_usd <= 9007199254740991
  ),
  claimed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE zero_friction_claim_challenges (
  challenge_hash TEXT PRIMARY KEY,
  pay_to TEXT NOT NULL,
  expires_at_epoch INTEGER NOT NULL,
  consumed_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX zero_friction_claim_challenges_expiry_idx
  ON zero_friction_claim_challenges(expires_at_epoch, consumed_at);

CREATE TABLE zero_friction_fee_events (
  logical_payment_key TEXT PRIMARY KEY REFERENCES settlement_projection(logical_payment_key),
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  pay_to TEXT NOT NULL REFERENCES zero_friction_accounts(pay_to),
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX zero_friction_fee_events_merchant_idx
  ON zero_friction_fee_events(merchant_id, created_at);

CREATE TABLE zero_friction_payments (
  payment_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  pay_to TEXT NOT NULL REFERENCES zero_friction_accounts(pay_to),
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  transaction_hash TEXT NOT NULL,
  transfer_log_index INTEGER NOT NULL CHECK (transfer_log_index >= 0),
  sender TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (
    amount_micro_usd > 0 AND amount_micro_usd <= 9007199254740991
  ),
  finalized_block INTEGER NOT NULL CHECK (finalized_block >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(network, transaction_hash, transfer_log_index)
);
CREATE INDEX zero_friction_payments_merchant_idx
  ON zero_friction_payments(merchant_id, created_at);
