CREATE TABLE IF NOT EXISTS commerce_source_runs (
  source_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  last_checked_at TEXT,
  last_success_at TEXT,
  last_error TEXT,
  imported_demands INTEGER NOT NULL DEFAULT 0,
  imported_offers INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS commerce_vendor_candidates (
  candidate_id TEXT PRIMARY KEY,
  source_name TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_ref TEXT,
  supplier_name TEXT NOT NULL,
  supplier_country TEXT,
  supplier_email TEXT,
  product_key TEXT NOT NULL,
  description TEXT NOT NULL,
  reference_value_usd REAL,
  evidence_level INTEGER NOT NULL DEFAULT 0,
  observed_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_commerce_vendor_candidate_identity
  ON commerce_vendor_candidates(source_name, source_ref, supplier_name, product_key);

CREATE INDEX IF NOT EXISTS idx_commerce_vendor_candidate_product
  ON commerce_vendor_candidates(product_key, observed_at DESC);
