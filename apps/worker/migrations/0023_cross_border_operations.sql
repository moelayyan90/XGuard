CREATE TABLE IF NOT EXISTS operations_organisations (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  api_key_sha256 TEXT NOT NULL,
  default_language TEXT NOT NULL DEFAULT 'en',
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_organisations_api_key
  ON operations_organisations(api_key_sha256);

CREATE TABLE IF NOT EXISTS operations_tasks (
  id TEXT PRIMARY KEY,
  organisation_id TEXT NOT NULL,
  external_reference TEXT,
  country_code TEXT NOT NULL,
  authority TEXT,
  workflow_type TEXT NOT NULL,
  source_language TEXT,
  preferred_language TEXT NOT NULL DEFAULT 'en',
  objective TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  due_at TEXT,
  exception_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organisation_id) REFERENCES operations_organisations(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_tasks_org_external_reference
  ON operations_tasks(organisation_id, external_reference)
  WHERE external_reference IS NOT NULL;

CREATE INDEX IF NOT EXISTS operations_tasks_org_status_due
  ON operations_tasks(organisation_id, status, due_at, updated_at DESC);

CREATE TABLE IF NOT EXISTS operations_task_events (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  details_json TEXT,
  event_sha256 TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (task_id) REFERENCES operations_tasks(id)
);

CREATE INDEX IF NOT EXISTS operations_task_events_task_created
  ON operations_task_events(task_id, created_at DESC);
