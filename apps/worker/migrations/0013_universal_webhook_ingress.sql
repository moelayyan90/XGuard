CREATE TABLE IF NOT EXISTS universal_webhook_routes (
  route_id TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  label TEXT,
  token_sha256 TEXT NOT NULL UNIQUE,
  destination_url TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  last_event_at TEXT,
  FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_universal_webhook_routes_merchant
  ON universal_webhook_routes(merchant_id, active, created_at DESC);

CREATE TABLE IF NOT EXISTS universal_webhook_events (
  event_id TEXT PRIMARY KEY,
  route_id TEXT NOT NULL,
  merchant_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  received_at TEXT NOT NULL,
  body_sha256 TEXT NOT NULL,
  body_bytes INTEGER NOT NULL,
  content_type TEXT,
  signature_header_names_json TEXT NOT NULL DEFAULT '[]',
  signature_evidence_sha256 TEXT,
  delivery_state TEXT NOT NULL CHECK (delivery_state IN ('RECEIVED', 'DELIVERED', 'DELIVERY_FAILED')),
  destination_status INTEGER,
  destination_latency_ms INTEGER,
  delivered_at TEXT,
  FOREIGN KEY (route_id) REFERENCES universal_webhook_routes(route_id),
  FOREIGN KEY (merchant_id) REFERENCES merchants(merchant_id)
);

CREATE INDEX IF NOT EXISTS idx_universal_webhook_events_merchant
  ON universal_webhook_events(merchant_id, received_at DESC);

CREATE INDEX IF NOT EXISTS idx_universal_webhook_events_route
  ON universal_webhook_events(route_id, received_at DESC);
