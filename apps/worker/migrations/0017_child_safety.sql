CREATE TABLE child_safety_scans (
  scan_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  external_event_id TEXT NOT NULL,
  risk_session_hash TEXT,
  content_kind TEXT NOT NULL,
  risk_level TEXT NOT NULL CHECK (risk_level IN ('LOW','MEDIUM','HIGH','CRITICAL')),
  action TEXT NOT NULL CHECK (action IN ('ALLOW','WARN','BLUR','BLOCK','FREEZE_CHAT','ESCALATE')),
  categories_json TEXT NOT NULL,
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(merchant_id, external_event_id)
);
CREATE INDEX child_safety_scans_merchant_created_idx
  ON child_safety_scans(merchant_id, created_at);
CREATE INDEX child_safety_scans_session_idx
  ON child_safety_scans(merchant_id, risk_session_hash, created_at);

CREATE TABLE child_safety_scan_charges (
  charge_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  external_event_id TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd > 0),
  state TEXT NOT NULL CHECK (state IN ('HELD','EARNED','RELEASED')),
  operation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(merchant_id, external_event_id)
);
CREATE INDEX child_safety_scan_charges_merchant_idx
  ON child_safety_scan_charges(merchant_id, state, created_at);
