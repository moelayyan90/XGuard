CREATE TABLE IF NOT EXISTS commerce_demands (
  demand_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_ref TEXT,
  buyer_name TEXT,
  buyer_country TEXT,
  buyer_email TEXT,
  product_key TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit TEXT,
  target_unit_price_usd REAL,
  deadline_at TEXT,
  payment_terms TEXT,
  evidence_level INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'OPEN',
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commerce_demands_status_product
  ON commerce_demands(status, product_key, deadline_at);

CREATE TABLE IF NOT EXISTS commerce_offers (
  offer_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  supplier_name TEXT,
  supplier_country TEXT,
  supplier_email TEXT,
  product_key TEXT NOT NULL,
  description TEXT NOT NULL,
  quantity_available REAL,
  unit_price_usd REAL NOT NULL,
  shipping_usd REAL NOT NULL DEFAULT 0,
  customs_usd REAL NOT NULL DEFAULT 0,
  tax_usd REAL NOT NULL DEFAULT 0,
  payment_fee_usd REAL NOT NULL DEFAULT 0,
  insurance_usd REAL NOT NULL DEFAULT 0,
  other_cost_usd REAL NOT NULL DEFAULT 0,
  lead_time_days INTEGER,
  stock_verified INTEGER NOT NULL DEFAULT 0,
  supplier_score INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_commerce_offers_product_price
  ON commerce_offers(product_key, unit_price_usd, expires_at);

CREATE TABLE IF NOT EXISTS commerce_opportunities (
  opportunity_id TEXT PRIMARY KEY,
  demand_id TEXT NOT NULL,
  offer_id TEXT NOT NULL,
  product_key TEXT NOT NULL,
  quantity REAL NOT NULL,
  revenue_usd REAL NOT NULL,
  landed_cost_usd REAL NOT NULL,
  reserve_usd REAL NOT NULL,
  net_profit_usd REAL NOT NULL,
  margin_bps INTEGER NOT NULL,
  score INTEGER NOT NULL,
  payment_before_purchase INTEGER NOT NULL DEFAULT 0,
  sanctions_clear INTEGER NOT NULL DEFAULT 0,
  restricted_goods_clear INTEGER NOT NULL DEFAULT 0,
  identity_match INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  rejection_reason TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(demand_id, offer_id),
  FOREIGN KEY(demand_id) REFERENCES commerce_demands(demand_id),
  FOREIGN KEY(offer_id) REFERENCES commerce_offers(offer_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_opportunities_rank
  ON commerce_opportunities(status, score DESC, net_profit_usd DESC);

CREATE TABLE IF NOT EXISTS commerce_outreach (
  outreach_id TEXT PRIMARY KEY,
  opportunity_id TEXT NOT NULL,
  recipient TEXT NOT NULL,
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  state TEXT NOT NULL,
  provider_message_id TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  UNIQUE(opportunity_id, recipient),
  FOREIGN KEY(opportunity_id) REFERENCES commerce_opportunities(opportunity_id)
);

CREATE INDEX IF NOT EXISTS idx_commerce_outreach_state
  ON commerce_outreach(state, created_at);

CREATE TABLE IF NOT EXISTS commerce_feeds (
  feed_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  url TEXT NOT NULL UNIQUE,
  format TEXT NOT NULL DEFAULT 'json',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
