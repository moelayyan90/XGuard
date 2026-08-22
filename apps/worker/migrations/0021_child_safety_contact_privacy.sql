UPDATE child_safety_institutional_contacts
SET source_ip_hash = NULL
WHERE source_ip_hash IS NOT NULL;
