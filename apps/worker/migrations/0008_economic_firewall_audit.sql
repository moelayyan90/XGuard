CREATE TABLE IF NOT EXISTS economic_firewall_audit_summary (
  verdict TEXT NOT NULL CHECK (verdict IN ('PASS', 'REVIEW')),
  reason TEXT NOT NULL CHECK (
    reason IN (
      'CORRELATED_AUTHORIZATION',
      'VERIFY_NOT_OBSERVED',
      'AUTHORIZATION_MISMATCH'
    )
  ),
  event_count INTEGER NOT NULL DEFAULT 0 CHECK (event_count >= 0),
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  PRIMARY KEY (verdict, reason)
);
