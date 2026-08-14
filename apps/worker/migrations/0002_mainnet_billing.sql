CREATE TABLE merchants (
  merchant_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  api_key_hash TEXT NOT NULL UNIQUE,
  available_balance_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (
    available_balance_micro_usd >= 0 AND available_balance_micro_usd <= 9007199254740991
  ),
  held_balance_micro_usd INTEGER NOT NULL DEFAULT 0 CHECK (
    held_balance_micro_usd >= 0 AND held_balance_micro_usd <= 9007199254740991
  ),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL
);

CREATE TABLE top_up_intents (
  intent_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  claim_token_hash TEXT NOT NULL UNIQUE,
  expected_amount_micro_usd INTEGER NOT NULL CHECK (
    expected_amount_micro_usd > 0 AND expected_amount_micro_usd <= 9007199254740991
  ),
  state TEXT NOT NULL CHECK (state IN ('OPEN','CLAIMED','EXPIRED')),
  expires_at_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  claimed_at TEXT
);
CREATE INDEX top_up_intents_merchant_idx ON top_up_intents(merchant_id, state, expires_at_epoch);

CREATE TABLE top_ups (
  top_up_id TEXT PRIMARY KEY,
  intent_id TEXT NOT NULL UNIQUE REFERENCES top_up_intents(intent_id),
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  external_reference TEXT NOT NULL UNIQUE,
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  asset TEXT NOT NULL,
  transaction_hash TEXT NOT NULL,
  transfer_log_index INTEGER NOT NULL CHECK (transfer_log_index >= 0),
  payer TEXT NOT NULL,
  treasury_address TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (
    amount_micro_usd > 0 AND amount_micro_usd <= 9007199254740991
  ),
  finalized_block INTEGER NOT NULL CHECK (finalized_block >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(network, transaction_hash, transfer_log_index)
);
CREATE INDEX top_ups_merchant_idx ON top_ups(merchant_id, created_at);

CREATE TABLE fee_reservations (
  logical_payment_key TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
  state TEXT NOT NULL CHECK (state IN ('CREATED','HELD','EARNED','RELEASED','AMBIGUOUS')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX fee_reservations_merchant_idx ON fee_reservations(merchant_id, state);
