CREATE TABLE IF NOT EXISTS watchdog_incidents (
  fingerprint TEXT PRIMARY KEY,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN' CHECK (status IN ('OPEN','RESOLVED')),
  script_name TEXT NOT NULL,
  route_key TEXT,
  method TEXT,
  path TEXT,
  outcome TEXT,
  http_status INTEGER,
  error_code TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  occurrences INTEGER NOT NULL DEFAULT 1,
  window_started_at TEXT NOT NULL,
  window_failures INTEGER NOT NULL DEFAULT 1,
  auto_action TEXT,
  action_state TEXT,
  action_count INTEGER NOT NULL DEFAULT 0,
  cooldown_until TEXT
);

CREATE INDEX IF NOT EXISTS idx_watchdog_incidents_status_last_seen
  ON watchdog_incidents(status, last_seen_at DESC);
CREATE INDEX IF NOT EXISTS idx_watchdog_incidents_route_last_seen
  ON watchdog_incidents(route_key, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS watchdog_breakers (
  route_key TEXT PRIMARY KEY,
  state TEXT NOT NULL CHECK (state IN ('OPEN','CLOSED')),
  reason TEXT NOT NULL,
  fingerprint TEXT,
  opened_at TEXT,
  expires_at TEXT,
  updated_at TEXT NOT NULL,
  failures INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_watchdog_breakers_state_expires
  ON watchdog_breakers(state, expires_at);

CREATE TABLE IF NOT EXISTS watchdog_probe_state (
  probe_key TEXT PRIMARY KEY,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  consecutive_successes INTEGER NOT NULL DEFAULT 0,
  last_status INTEGER,
  last_error_code TEXT,
  last_checked_at TEXT NOT NULL
);
