CREATE TABLE IF NOT EXISTS api_keys (
  key_hash TEXT PRIMARY KEY,
  key_prefix TEXT NOT NULL UNIQUE,
  credits_remaining INTEGER NOT NULL DEFAULT 0 CHECK (credits_remaining >= 0),
  checks_total INTEGER NOT NULL DEFAULT 0 CHECK (checks_total >= 0),
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  created_at TEXT NOT NULL,
  last_used_at TEXT
);

CREATE TABLE IF NOT EXISTS free_key_claims (
  claim_hash TEXT PRIMARY KEY,
  key_prefix TEXT NOT NULL,
  claimed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS usage_daily (
  key_prefix TEXT NOT NULL,
  day TEXT NOT NULL,
  checks INTEGER NOT NULL DEFAULT 0 CHECK (checks >= 0),
  rejected INTEGER NOT NULL DEFAULT 0 CHECK (rejected >= 0),
  PRIMARY KEY (key_prefix, day)
);

CREATE INDEX IF NOT EXISTS api_keys_active_prefix_idx ON api_keys(active, key_prefix);
CREATE INDEX IF NOT EXISTS usage_daily_day_idx ON usage_daily(day);
