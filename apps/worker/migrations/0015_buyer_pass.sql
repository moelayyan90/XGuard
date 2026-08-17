CREATE TABLE buyer_passes (
  pass_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL UNIQUE REFERENCES merchants(merchant_id),
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  channel TEXT NOT NULL CHECK (channel IN ('browser','agent','api')),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE INDEX buyer_pass_token_idx ON buyer_passes(token_hash, active);
CREATE INDEX buyer_pass_merchant_idx ON buyer_passes(merchant_id, active);
