UPDATE merchants
SET api_key_scopes = api_key_scopes || ',gateway'
WHERE instr(',' || api_key_scopes || ',', ',gateway,') = 0;

CREATE TABLE gateway_fee_reservations (
  event_key TEXT PRIMARY KEY,
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MODEL','TOOL','SOURCE','ANALYSIS','SECURITY')),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL CHECK (
    amount_micro_usd > 0 AND amount_micro_usd <= 9007199254740991
  ),
  state TEXT NOT NULL CHECK (state IN ('HELD','EARNED','RELEASED')),
  operation_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(merchant_id, request_id)
);
CREATE INDEX gateway_fee_reservations_merchant_idx
  ON gateway_fee_reservations(merchant_id, state, created_at);

CREATE TABLE gateway_usage_events (
  event_id TEXT PRIMARY KEY,
  event_key TEXT NOT NULL UNIQUE REFERENCES gateway_fee_reservations(event_key),
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  request_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('MODEL','TOOL','SOURCE','ANALYSIS','SECURITY')),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  fee_micro_usd INTEGER NOT NULL CHECK (fee_micro_usd > 0),
  upstream_status INTEGER,
  latency_ms INTEGER NOT NULL CHECK (latency_ms >= 0),
  request_bytes INTEGER NOT NULL DEFAULT 0 CHECK (request_bytes >= 0),
  response_bytes INTEGER NOT NULL DEFAULT 0 CHECK (response_bytes >= 0),
  created_at TEXT NOT NULL,
  UNIQUE(merchant_id, request_id)
);
CREATE INDEX gateway_usage_events_merchant_idx
  ON gateway_usage_events(merchant_id, created_at);
CREATE INDEX gateway_usage_events_kind_idx
  ON gateway_usage_events(kind, provider, created_at);
