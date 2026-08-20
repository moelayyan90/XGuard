CREATE TABLE IF NOT EXISTS eudr_inboxes (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL UNIQUE,
  organisation_name TEXT NOT NULL,
  contact_email TEXT NOT NULL,
  admin_key_sha256 TEXT NOT NULL,
  partner_mode INTEGER NOT NULL DEFAULT 0,
  revenue_share_bps INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS eudr_reference_intake (
  id TEXT PRIMARY KEY,
  inbox_id TEXT NOT NULL,
  supplier_name TEXT NOT NULL,
  supplier_email TEXT,
  dds_reference TEXT NOT NULL,
  verification_number_sha256 TEXT,
  shipment_reference TEXT,
  product_description TEXT,
  origin_country TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  evidence_sha256 TEXT NOT NULL,
  received_at TEXT NOT NULL,
  FOREIGN KEY (inbox_id) REFERENCES eudr_inboxes(id)
);

CREATE UNIQUE INDEX IF NOT EXISTS eudr_reference_dedupe
  ON eudr_reference_intake(inbox_id, dds_reference, COALESCE(shipment_reference, ''));

CREATE INDEX IF NOT EXISTS eudr_reference_inbox_received
  ON eudr_reference_intake(inbox_id, received_at DESC);
