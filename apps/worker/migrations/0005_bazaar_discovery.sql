CREATE TABLE IF NOT EXISTS bazaar_resources (
  resource_key TEXT PRIMARY KEY,
  resource_url TEXT NOT NULL,
  resource_type TEXT NOT NULL CHECK(resource_type IN ('http','mcp')),
  x402_version INTEGER NOT NULL CHECK(x402_version = 2),
  accepts_json TEXT NOT NULL,
  extensions_json TEXT NOT NULL,
  metadata_json TEXT NOT NULL,
  pay_to TEXT NOT NULL,
  scheme TEXT NOT NULL,
  network TEXT NOT NULL,
  tool_name TEXT,
  search_text TEXT NOT NULL,
  first_seen_epoch INTEGER NOT NULL,
  last_updated_epoch INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bazaar_resources_type_updated
  ON bazaar_resources(resource_type, last_updated_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_bazaar_resources_pay_to
  ON bazaar_resources(pay_to, last_updated_epoch DESC);
CREATE INDEX IF NOT EXISTS idx_bazaar_resources_scheme_network
  ON bazaar_resources(scheme, network, last_updated_epoch DESC);
