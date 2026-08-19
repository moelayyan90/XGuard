CREATE TABLE migration_operation_charges (
  operation_id TEXT PRIMARY KEY,
  principal_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  operation_type TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (
    amount_micro_usd > 0 AND amount_micro_usd <= 9007199254740991
  ),
  state TEXT NOT NULL CHECK (state IN ('HELD','EARNED','RELEASED')),
  request_nonce TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX migration_operation_charges_principal_idx
  ON migration_operation_charges(principal_id, state, created_at);

CREATE TABLE migration_usage_events (
  event_id TEXT PRIMARY KEY,
  operation_id TEXT NOT NULL UNIQUE REFERENCES migration_operation_charges(operation_id),
  principal_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  operation_type TEXT NOT NULL,
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd > 0),
  created_at TEXT NOT NULL
);
CREATE INDEX migration_usage_events_principal_idx
  ON migration_usage_events(principal_id, created_at);
