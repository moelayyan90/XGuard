CREATE TABLE child_safety_dashboard_sessions (
  session_hash TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  expires_at_epoch INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX child_safety_dashboard_sessions_merchant_idx
  ON child_safety_dashboard_sessions(merchant_id, expires_at_epoch);

CREATE INDEX child_safety_scans_risk_actor_idx
  ON child_safety_scans(merchant_id, risk_level, actor_hash, created_at);
