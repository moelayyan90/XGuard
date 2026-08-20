CREATE TABLE IF NOT EXISTS xguard_mail_messages (
  message_id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL CHECK (mailbox IN ('info','support')),
  direction TEXT NOT NULL CHECK (direction IN ('INBOUND','OUTBOUND')),
  from_address TEXT NOT NULL,
  to_address TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body_preview TEXT NOT NULL DEFAULT '',
  provider_message_id TEXT,
  status TEXT NOT NULL DEFAULT 'RECEIVED',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_xguard_mail_messages_mailbox_created
ON xguard_mail_messages(mailbox, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_xguard_mail_messages_direction_created
ON xguard_mail_messages(direction, created_at DESC);
