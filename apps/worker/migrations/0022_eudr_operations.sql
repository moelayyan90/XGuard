CREATE TABLE IF NOT EXISTS eudr_suppliers (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  email TEXT,
  country TEXT,
  status TEXT NOT NULL DEFAULT 'INVITED',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS eudr_suppliers_org_status
  ON eudr_suppliers(organisation_id, status);

CREATE TABLE IF NOT EXISTS eudr_cases (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  supplier_id TEXT,
  external_reference TEXT,
  commodity TEXT,
  cn_code TEXT,
  origin_country TEXT,
  status TEXT NOT NULL DEFAULT 'PREPARING',
  readiness_percent INTEGER NOT NULL DEFAULT 0,
  live_execution_required INTEGER NOT NULL DEFAULT 1,
  eu_reference TEXT,
  evidence_sha256 TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (supplier_id) REFERENCES eudr_suppliers(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS eudr_cases_org_external_reference
  ON eudr_cases(organisation_id, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS eudr_cases_org_status
  ON eudr_cases(organisation_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS eudr_case_tasks (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  owner_type TEXT NOT NULL,
  task_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'OPEN',
  required_field TEXT,
  message TEXT,
  due_at TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  FOREIGN KEY (case_id) REFERENCES eudr_cases(id)
);

CREATE INDEX IF NOT EXISTS eudr_case_tasks_case_status
  ON eudr_case_tasks(case_id, status);

CREATE TABLE IF NOT EXISTS eudr_evidence (
  id TEXT PRIMARY KEY,
  case_id TEXT NOT NULL,
  evidence_type TEXT NOT NULL,
  source TEXT NOT NULL,
  source_reference TEXT,
  content_sha256 TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  valid_from TEXT,
  valid_until TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (case_id) REFERENCES eudr_cases(id)
);

CREATE INDEX IF NOT EXISTS eudr_evidence_case_type
  ON eudr_evidence(case_id, evidence_type, version DESC);

CREATE TABLE IF NOT EXISTS eudr_audit_events (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  case_id TEXT,
  actor_type TEXT NOT NULL,
  event_type TEXT NOT NULL,
  event_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS eudr_audit_events_case_created
  ON eudr_audit_events(case_id, created_at DESC);
