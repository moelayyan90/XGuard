CREATE TABLE IF NOT EXISTS child_safety_institutional_contacts (
  contact_id TEXT PRIMARY KEY,
  organization TEXT NOT NULL,
  role_title TEXT NOT NULL DEFAULT '',
  country TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL,
  website TEXT NOT NULL DEFAULT '',
  inquiry_type TEXT NOT NULL,
  message TEXT NOT NULL,
  source_ip_hash TEXT,
  status TEXT NOT NULL DEFAULT 'NEW',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_child_safety_institutional_contacts_created
ON child_safety_institutional_contacts(created_at DESC);

CREATE INDEX IF NOT EXISTS idx_child_safety_institutional_contacts_status_created
ON child_safety_institutional_contacts(status, created_at DESC);
