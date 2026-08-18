CREATE TABLE mcp_oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE mcp_oauth_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL,
  expires_at_epoch INTEGER NOT NULL CHECK (expires_at_epoch > 0),
  used_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX mcp_oauth_codes_expiry_idx
  ON mcp_oauth_codes(expires_at_epoch, used_at);
