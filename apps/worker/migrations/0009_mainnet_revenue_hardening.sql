ALTER TABLE merchants ADD COLUMN api_key_scopes TEXT NOT NULL DEFAULT 'billing,settle,verify';
ALTER TABLE merchants ADD COLUMN api_key_rotated_at TEXT;

CREATE TABLE verify_fee_holds (
  logical_payment_key TEXT PRIMARY KEY REFERENCES fee_reservations(logical_payment_key),
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  state TEXT NOT NULL CHECK (state IN ('VERIFY_HELD','SETTLE_CLAIMED')),
  expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch > 0),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX verify_fee_holds_expiry_idx ON verify_fee_holds(state, expires_at_epoch);

CREATE TABLE treasury_scan_state (
  scanner_id TEXT PRIMARY KEY,
  last_scanned_block INTEGER NOT NULL CHECK (last_scanned_block >= 0),
  updated_at TEXT NOT NULL
);

CREATE TABLE runtime_economics (
  singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
  downstream_cost_micro_usd INTEGER NOT NULL CHECK (downstream_cost_micro_usd >= 0),
  min_gross_margin_bps INTEGER NOT NULL CHECK (min_gross_margin_bps >= 0 AND min_gross_margin_bps <= 10000),
  updated_at TEXT NOT NULL
);
