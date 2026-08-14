PRAGMA foreign_keys = ON;

CREATE TABLE facilitator_health (
  facilitator_id TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('HEALTHY','DEGRADED','OPEN','HALF_OPEN','QUARANTINED','DISABLED')),
  consecutive_failures INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  latency_ms INTEGER,
  last_error_code TEXT,
  capabilities_json TEXT,
  checked_at TEXT NOT NULL
);

CREATE TABLE payment_identifiers (
  identifier TEXT PRIMARY KEY,
  logical_payment_key TEXT NOT NULL,
  expires_at_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX payment_identifiers_expiry_idx ON payment_identifiers(expires_at_epoch);

CREATE TABLE settlement_projection (
  logical_payment_key TEXT PRIMARY KEY,
  request_fingerprint TEXT NOT NULL,
  payment_identifier TEXT,
  network TEXT NOT NULL,
  facilitator_id TEXT,
  state TEXT NOT NULL CHECK (state IN ('SETTLED','FAILED','AMBIGUOUS')),
  transaction_hash TEXT,
  testnet INTEGER NOT NULL CHECK (testnet IN (0,1)),
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd >= 0),
  downstream_cost_micro_usd INTEGER NOT NULL CHECK (downstream_cost_micro_usd >= 0),
  recorded_at TEXT NOT NULL
);

CREATE TABLE usage_events (
  event_id TEXT PRIMARY KEY,
  logical_payment_key TEXT NOT NULL UNIQUE REFERENCES settlement_projection(logical_payment_key),
  kind TEXT NOT NULL CHECK (kind = 'SUCCESSFUL_BILLABLE_SETTLEMENT'),
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd > 0),
  created_at TEXT NOT NULL
);

CREATE TABLE ledger_entries (
  entry_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  account TEXT NOT NULL CHECK (account IN (
    'CUSTOMER_BALANCES','UNEARNED_LIABILITY','EARNED_REVENUE','OPERATING_EXPENSE',
    'OPERATING_RESERVE','OWNER_DISTRIBUTABLE','PAID_TO_OWNER','CASH'
  )),
  side TEXT NOT NULL CHECK (side IN ('DEBIT','CREDIT')),
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
  created_at TEXT NOT NULL,
  UNIQUE(event_id, account, side)
);
CREATE INDEX ledger_entries_event_idx ON ledger_entries(event_id);

CREATE TABLE reconciliation_cases (
  case_id TEXT PRIMARY KEY,
  logical_payment_key TEXT,
  reason_code TEXT NOT NULL,
  details_json TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'OPEN' CHECK (state IN ('OPEN','RESOLVED','QUARANTINED')),
  created_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE TABLE operating_expenses (
  expense_id TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
  incurred_at TEXT NOT NULL,
  evidence_reference TEXT NOT NULL
);

CREATE TABLE owner_distributions (
  distribution_id TEXT PRIMARY KEY,
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
  state TEXT NOT NULL CHECK (state IN ('PROPOSED','SUBMITTED','PENDING','PAID','AMBIGUOUS','REJECTED')),
  provider_reference TEXT UNIQUE,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE audit_events (
  audit_id TEXT PRIMARY KEY,
  event_type TEXT NOT NULL,
  subject_hash TEXT,
  details_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);
