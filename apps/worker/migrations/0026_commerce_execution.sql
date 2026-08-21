CREATE TABLE IF NOT EXISTS commerce_trade_verifications (
  opportunity_id TEXT PRIMARY KEY,
  buyer_payment_secured INTEGER NOT NULL DEFAULT 0,
  buyer_funds_available INTEGER NOT NULL DEFAULT 0,
  buyer_identity_verified INTEGER NOT NULL DEFAULT 0,
  supplier_identity_verified INTEGER NOT NULL DEFAULT 0,
  supplier_inventory_verified INTEGER NOT NULL DEFAULT 0,
  evidence_json TEXT NOT NULL DEFAULT '{}',
  verified_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(opportunity_id) REFERENCES commerce_opportunities(opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_trade_verifications_ready
  ON commerce_trade_verifications(
    buyer_payment_secured,
    buyer_funds_available,
    buyer_identity_verified,
    supplier_identity_verified,
    supplier_inventory_verified
  );

CREATE TABLE IF NOT EXISTS commerce_executions (
  execution_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  connector_ref TEXT,
  expected_revenue_usd REAL NOT NULL,
  expected_cost_usd REAL NOT NULL,
  expected_profit_usd REAL NOT NULL,
  actual_revenue_usd REAL,
  actual_cost_usd REAL,
  actual_profit_usd REAL,
  last_error TEXT,
  submitted_at TEXT,
  confirmed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(opportunity_id) REFERENCES commerce_opportunities(opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_executions_state
  ON commerce_executions(state, updated_at);

CREATE TABLE IF NOT EXISTS commerce_execution_events (
  event_id TEXT PRIMARY KEY,
  execution_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  FOREIGN KEY(execution_id) REFERENCES commerce_executions(execution_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_execution_events_execution
  ON commerce_execution_events(execution_id, created_at DESC);
