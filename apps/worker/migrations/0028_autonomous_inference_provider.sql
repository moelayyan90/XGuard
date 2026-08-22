CREATE TABLE IF NOT EXISTS provider_prices (
  price_id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  service TEXT NOT NULL,
  model TEXT NOT NULL DEFAULT '',
  billing_mode TEXT NOT NULL,
  input_micro_usd_per_million INTEGER NOT NULL DEFAULT 0,
  output_micro_usd_per_million INTEGER NOT NULL DEFAULT 0,
  request_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  context_limit INTEGER,
  quality_tier INTEGER NOT NULL DEFAULT 1,
  typical_latency_ms INTEGER,
  capabilities_json TEXT NOT NULL DEFAULT '[]',
  terms_mode TEXT NOT NULL CHECK(terms_mode IN ('public-data','byok','contract-required','excluded')),
  source_url TEXT NOT NULL,
  effective_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  UNIQUE(provider, service, model, effective_at)
);

CREATE INDEX IF NOT EXISTS idx_provider_prices_route
  ON provider_prices(service, enabled, quality_tier, request_cost_micro_usd);

CREATE TABLE IF NOT EXISTS networks (
  network_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider_portal_url TEXT NOT NULL,
  public_api_base_url TEXT,
  provider_interface_status TEXT NOT NULL CHECK(provider_interface_status IN ('UNVERIFIED','VERIFIED')),
  application_status TEXT NOT NULL CHECK(application_status IN ('NOT_APPLIED','APPLIED','ACCEPTED','LIVE','BLOCKED')),
  payout_mode TEXT NOT NULL CHECK(payout_mode IN ('UNKNOWN','ON_CHAIN','MANUAL','AUTOMATIC')),
  payout_rules_source_url TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS upstream_providers (
  provider_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  slot INTEGER NOT NULL UNIQUE,
  base_url TEXT NOT NULL,
  api_style TEXT NOT NULL CHECK(api_style IN ('OPENAI_CHAT')),
  legal_status TEXT NOT NULL CHECK(legal_status IN ('UNREVIEWED','REVIEW_REQUIRED','APPROVED','REJECTED')),
  legal_evidence_url TEXT,
  legal_evidence_note TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS models (
  model_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  modality TEXT NOT NULL DEFAULT 'text',
  upstream_model TEXT NOT NULL,
  provider_id TEXT,
  network_id TEXT NOT NULL,
  network_model_id TEXT NOT NULL,
  input_price_micro_usd_per_million INTEGER NOT NULL DEFAULT 0,
  output_price_micro_usd_per_million INTEGER NOT NULL DEFAULT 0,
  max_context_tokens INTEGER,
  status TEXT NOT NULL CHECK(status IN ('CANDIDATE','READY','ACTIVE','PAUSED','BLOCKED')),
  status_reason TEXT,
  enabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(provider_id) REFERENCES upstream_providers(provider_id),
  FOREIGN KEY(network_id) REFERENCES networks(network_id),
  UNIQUE(network_id, network_model_id, provider_id)
);

CREATE INDEX IF NOT EXISTS idx_models_active
  ON models(network_id, status, enabled, model_id);

CREATE TABLE IF NOT EXISTS provider_health (
  health_id TEXT PRIMARY KEY,
  provider_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('HEALTHY','DEGRADED','UNHEALTHY','UNCONFIGURED')),
  latency_ms INTEGER,
  http_status INTEGER,
  consecutive_failures INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  FOREIGN KEY(provider_id) REFERENCES upstream_providers(provider_id)
);

CREATE INDEX IF NOT EXISTS idx_provider_health_latest
  ON provider_health(provider_id, checked_at DESC);

CREATE TABLE IF NOT EXISTS network_requests (
  request_id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  network_request_id TEXT,
  request_hash TEXT NOT NULL,
  client_hash TEXT,
  model_id TEXT NOT NULL,
  stream INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  quoted_revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL CHECK(status IN ('RECEIVED','BLOCKED','ROUTING','STREAMING','SUCCEEDED','FAILED')),
  error_code TEXT,
  received_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(network_id) REFERENCES networks(network_id),
  UNIQUE(network_id, network_request_id)
);

CREATE INDEX IF NOT EXISTS idx_network_requests_today
  ON network_requests(network_id, received_at DESC, status);

CREATE TABLE IF NOT EXISTS upstream_requests (
  upstream_request_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  upstream_model TEXT NOT NULL,
  estimated_cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  actual_cost_micro_usd INTEGER,
  cost_basis TEXT NOT NULL CHECK(cost_basis IN ('ESTIMATED','USAGE_REPORTED','PROVIDER_INVOICE')),
  prompt_tokens INTEGER,
  completion_tokens INTEGER,
  latency_ms INTEGER,
  status TEXT NOT NULL CHECK(status IN ('STARTED','SUCCEEDED','FAILED','TIMED_OUT','BLOCKED_BY_MARGIN')),
  error_code TEXT,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY(request_id) REFERENCES network_requests(request_id),
  FOREIGN KEY(provider_id) REFERENCES upstream_providers(provider_id),
  UNIQUE(request_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_upstream_requests_provider
  ON upstream_requests(provider_id, started_at DESC, status);

CREATE TABLE IF NOT EXISTS routing_metrics (
  bucket_at TEXT NOT NULL,
  network_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  requests INTEGER NOT NULL DEFAULT 0,
  successes INTEGER NOT NULL DEFAULT 0,
  failures INTEGER NOT NULL DEFAULT 0,
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  latency_sum_ms INTEGER NOT NULL DEFAULT 0,
  revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY(bucket_at, network_id, model_id, provider_id)
);

CREATE TABLE IF NOT EXISTS settlements (
  settlement_id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  external_settlement_id TEXT NOT NULL,
  currency TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL,
  transaction_reference TEXT,
  evidence_url TEXT,
  status TEXT NOT NULL CHECK(status IN ('PENDING','SETTLED','WITHDRAWABLE','WITHDRAWN','RECEIVED_BY_OWNER','REJECTED')),
  occurred_at TEXT NOT NULL,
  recorded_at TEXT NOT NULL,
  UNIQUE(network_id, external_settlement_id)
);

CREATE TABLE IF NOT EXISTS revenue (
  revenue_id TEXT PRIMARY KEY,
  request_id TEXT,
  settlement_id TEXT,
  network_id TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  state TEXT NOT NULL CHECK(state IN ('QUOTED','PENDING','SETTLED','WITHDRAWABLE','WITHDRAWN','RECEIVED_BY_OWNER')),
  evidence_reference TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(request_id) REFERENCES network_requests(request_id),
  FOREIGN KEY(settlement_id) REFERENCES settlements(settlement_id)
);

CREATE INDEX IF NOT EXISTS idx_revenue_state_day
  ON revenue(state, created_at DESC);

CREATE TABLE IF NOT EXISTS costs (
  cost_id TEXT PRIMARY KEY,
  request_id TEXT,
  upstream_request_id TEXT,
  provider_id TEXT,
  cost_type TEXT NOT NULL CHECK(cost_type IN ('UPSTREAM','NETWORK','VARIABLE_INFRA')),
  amount_micro_usd INTEGER NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  basis TEXT NOT NULL CHECK(basis IN ('ESTIMATED','USAGE_REPORTED','PROVIDER_INVOICE','CLOUDFLARE','NETWORK_TERMS','CONFIGURED_RATE')),
  incurred_at TEXT NOT NULL,
  evidence_reference TEXT,
  FOREIGN KEY(request_id) REFERENCES network_requests(request_id),
  FOREIGN KEY(upstream_request_id) REFERENCES upstream_requests(upstream_request_id)
);

CREATE INDEX IF NOT EXISTS idx_costs_day ON costs(incurred_at DESC);

CREATE TABLE IF NOT EXISTS payouts (
  payout_id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  amount_micro_usd INTEGER NOT NULL,
  currency TEXT NOT NULL,
  destination_fingerprint TEXT,
  external_reference TEXT,
  status TEXT NOT NULL CHECK(status IN ('REQUESTED','WITHDRAWN','RECEIVED_BY_OWNER','FAILED','UNSUPPORTED')),
  requested_at TEXT NOT NULL,
  completed_at TEXT,
  evidence_reference TEXT
);

CREATE TABLE IF NOT EXISTS pricing_history (
  pricing_id TEXT PRIMARY KEY,
  model_id TEXT NOT NULL,
  provider_id TEXT,
  network_id TEXT NOT NULL,
  upstream_input_micro_usd_per_million INTEGER NOT NULL,
  upstream_output_micro_usd_per_million INTEGER NOT NULL,
  sale_input_micro_usd_per_million INTEGER NOT NULL,
  sale_output_micro_usd_per_million INTEGER NOT NULL,
  minimum_margin_micro_usd INTEGER NOT NULL,
  minimum_margin_percent REAL NOT NULL,
  source_url TEXT,
  effective_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_pricing_history_model
  ON pricing_history(model_id, effective_at DESC);

CREATE TABLE IF NOT EXISTS profit_hourly (
  bucket_at TEXT PRIMARY KEY,
  settled_revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  pending_revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  net_profit_micro_usd INTEGER NOT NULL DEFAULT 0,
  real_requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS profit_daily (
  day TEXT PRIMARY KEY,
  settled_revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  pending_revenue_micro_usd INTEGER NOT NULL DEFAULT 0,
  withdrawable_micro_usd INTEGER NOT NULL DEFAULT 0,
  paid_to_owner_micro_usd INTEGER NOT NULL DEFAULT 0,
  cost_micro_usd INTEGER NOT NULL DEFAULT 0,
  net_profit_micro_usd INTEGER NOT NULL DEFAULT 0,
  real_requests INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS optimization_runs (
  run_id TEXT PRIMARY KEY,
  started_at TEXT NOT NULL,
  completed_at TEXT,
  status TEXT NOT NULL CHECK(status IN ('RUNNING','SUCCEEDED','FAILED','SKIPPED')),
  models_examined INTEGER NOT NULL DEFAULT 0,
  routes_changed INTEGER NOT NULL DEFAULT 0,
  reason TEXT,
  decisions_json TEXT NOT NULL DEFAULT '[]'
);

CREATE TABLE IF NOT EXISTS alerts (
  alert_id TEXT PRIMARY KEY,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK(severity IN ('INFO','WARNING','CRITICAL')),
  status TEXT NOT NULL CHECK(status IN ('OPEN','RESOLVED')),
  message TEXT NOT NULL,
  first_seen_at TEXT NOT NULL,
  last_seen_at TEXT NOT NULL,
  resolved_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_alerts_status
  ON alerts(status, severity, last_seen_at DESC);

CREATE TABLE IF NOT EXISTS opportunity_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  network_id TEXT NOT NULL,
  model_id TEXT NOT NULL,
  signal_type TEXT NOT NULL,
  observed_input_micro_usd_per_million INTEGER,
  observed_output_micro_usd_per_million INTEGER,
  demand_value REAL,
  competition_value REAL,
  demand_score REAL,
  competition_score REAL,
  price_score REAL,
  cost_score REAL,
  latency_score REAL,
  margin_score REAL,
  opportunity_score REAL,
  score_status TEXT NOT NULL DEFAULT 'INSUFFICIENT_DATA' CHECK(score_status IN ('INSUFFICIENT_DATA','SCORED')),
  source_url TEXT NOT NULL,
  observed_at TEXT NOT NULL,
  note TEXT NOT NULL
);

INSERT OR IGNORE INTO networks(
  network_id,name,provider_portal_url,public_api_base_url,
  provider_interface_status,application_status,payout_mode,
  payout_rules_source_url,enabled,created_at,updated_at
) VALUES(
  'dgrid','DGrid','https://dgrid.ai/marketplace','https://api.dgrid.ai/v1',
  'UNVERIFIED','NOT_APPLIED','UNKNOWN',
  'https://blog.dgrid.ai/posts/2026-07-23/',0,
  '2026-08-22T00:00:00Z','2026-08-22T00:00:00Z'
);

INSERT OR IGNORE INTO models(
  model_id,display_name,modality,upstream_model,provider_id,network_id,
  network_model_id,input_price_micro_usd_per_million,
  output_price_micro_usd_per_million,max_context_tokens,status,status_reason,
  enabled,created_at,updated_at
) VALUES
  ('candidate-qwen-3-7-flash','Qwen 3.7 Flash','multimodal','qwen3.7-flash',NULL,'dgrid','qwen/qwen3.7-flash',30000,130000,1000000,'CANDIDATE','No resale-approved upstream or credential is configured',0,'2026-08-22T00:00:00Z','2026-08-22T00:00:00Z'),
  ('candidate-deepseek-v4-flash','DeepSeek V4 Flash 0731','text','deepseek-v4-flash-0731',NULL,'dgrid','deepseek/deepseek-v4-flash-0731',220000,660000,1000000,'CANDIDATE','No resale-approved upstream or credential is configured',0,'2026-08-22T00:00:00Z','2026-08-22T00:00:00Z'),
  ('candidate-qwen-embedding-v4','Qwen Text Embedding V4','embedding','text-embedding-v4',NULL,'dgrid','qwen/text-embedding-v4',70000,0,8192,'CANDIDATE','Embedding execution is not enabled',0,'2026-08-22T00:00:00Z','2026-08-22T00:00:00Z');

INSERT OR IGNORE INTO opportunity_snapshots(
  snapshot_id,network_id,model_id,signal_type,
  observed_input_micro_usd_per_million,observed_output_micro_usd_per_million,
  demand_value,competition_value,source_url,observed_at,note
) VALUES
  ('dgrid-qwen-3-7-flash-20260822','dgrid','qwen/qwen3.7-flash','CATALOG_OBSERVATION',30000,130000,NULL,NULL,'https://dgrid.ai/models','2026-08-22T00:00:00Z','Catalog and price observation only; DGrid did not publish traffic, demand, provider count, or routing share.'),
  ('dgrid-deepseek-v4-flash-20260822','dgrid','deepseek/deepseek-v4-flash-0731','CATALOG_OBSERVATION',220000,660000,NULL,NULL,'https://dgrid.ai/models','2026-08-22T00:00:00Z','Catalog and price observation only; DGrid did not publish traffic, demand, provider count, or routing share.'),
  ('dgrid-qwen-embedding-v4-20260822','dgrid','qwen/text-embedding-v4','CATALOG_OBSERVATION',70000,0,NULL,NULL,'https://dgrid.ai/models','2026-08-22T00:00:00Z','Catalog and price observation only; DGrid did not publish traffic, demand, provider count, or routing share.');
