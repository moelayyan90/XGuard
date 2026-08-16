CREATE TABLE IF NOT EXISTS economic_firewall_shadow_observations (
  merchant_id TEXT NOT NULL,
  intent_id TEXT NOT NULL,
  terms_hash TEXT NOT NULL,
  first_authorization_hash TEXT NOT NULL,
  last_authorization_hash TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (amount_micro_usd >= 0),
  expires_at TEXT NOT NULL,
  verify_count INTEGER NOT NULL DEFAULT 0 CHECK (verify_count >= 0),
  settle_count INTEGER NOT NULL DEFAULT 0 CHECK (settle_count >= 0),
  authorization_mismatch_count INTEGER NOT NULL DEFAULT 0 CHECK (authorization_mismatch_count >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, intent_id)
);

CREATE INDEX IF NOT EXISTS idx_economic_firewall_shadow_expires
  ON economic_firewall_shadow_observations(expires_at);

CREATE INDEX IF NOT EXISTS idx_economic_firewall_shadow_last_seen
  ON economic_firewall_shadow_observations(last_seen_at);
