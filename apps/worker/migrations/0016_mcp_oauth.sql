CREATE TABLE oauth_clients (
  client_id TEXT PRIMARY KEY,
  client_name TEXT NOT NULL,
  redirect_uris_json TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE oauth_authorization_codes (
  code_hash TEXT PRIMARY KEY,
  client_id TEXT NOT NULL REFERENCES oauth_clients(client_id),
  redirect_uri TEXT NOT NULL,
  code_challenge TEXT NOT NULL,
  scope TEXT NOT NULL CHECK (scope = 'xguard:mcp'),
  expires_at_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  used_at TEXT
);

CREATE INDEX oauth_authorization_codes_client_idx
  ON oauth_authorization_codes(client_id, expires_at_epoch);
CREATE INDEX oauth_authorization_codes_expiry_idx
  ON oauth_authorization_codes(expires_at_epoch, used_at);
