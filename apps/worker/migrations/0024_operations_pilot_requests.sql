CREATE TABLE IF NOT EXISTS operations_pilot_requests (
  id TEXT PRIMARY KEY,
  organisation_name TEXT NOT NULL,
  contact_name TEXT,
  contact_email TEXT NOT NULL,
  country_code TEXT,
  website TEXT,
  workflow_interest TEXT NOT NULL,
  estimated_monthly_cases INTEGER,
  message TEXT,
  source TEXT NOT NULL DEFAULT 'website',
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS operations_pilot_requests_email_org
  ON operations_pilot_requests(contact_email, organisation_name);

CREATE INDEX IF NOT EXISTS operations_pilot_requests_status_created
  ON operations_pilot_requests(status, created_at DESC);
