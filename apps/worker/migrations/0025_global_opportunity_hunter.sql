CREATE TABLE IF NOT EXISTS hunter_opportunities (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  buyer_price_micro_usd INTEGER NOT NULL,
  landed_cost_micro_usd INTEGER NOT NULL,
  net_profit_micro_usd INTEGER NOT NULL,
  margin_bps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  risk_score INTEGER NOT NULL,
  shariah_status TEXT NOT NULL,
  shariah_reason TEXT NOT NULL,
  buyer_payment_secured INTEGER NOT NULL DEFAULT 0,
  buyer_funds_available INTEGER NOT NULL DEFAULT 0,
  supplier_reliability_bps INTEGER NOT NULL DEFAULT 0,
  state TEXT NOT NULL,
  reasons_json TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  execution_attempts INTEGER NOT NULL DEFAULT 0,
  execution_ref TEXT,
  last_error TEXT,
  executed_at TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(source, external_id)
);

CREATE INDEX IF NOT EXISTS idx_hunter_opportunities_state_score
  ON hunter_opportunities(state, score DESC, net_profit_micro_usd DESC);

CREATE INDEX IF NOT EXISTS idx_hunter_opportunities_observed_at
  ON hunter_opportunities(observed_at DESC);

CREATE TABLE IF NOT EXISTS hunter_execution_events (
  id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  detail TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(opportunity_id) REFERENCES hunter_opportunities(id)
);

CREATE INDEX IF NOT EXISTS idx_hunter_execution_events_opportunity
  ON hunter_execution_events(opportunity_id, created_at DESC);
