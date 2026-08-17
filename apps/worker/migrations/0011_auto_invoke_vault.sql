CREATE TABLE gateway_provider_credentials (
  merchant_id TEXT NOT NULL REFERENCES merchants(merchant_id),
  provider TEXT NOT NULL CHECK (provider IN ('openai','anthropic','gemini')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  key_version TEXT NOT NULL CHECK (key_version='v1'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (merchant_id, provider)
);

CREATE INDEX gateway_provider_credentials_merchant_idx
  ON gateway_provider_credentials(merchant_id, updated_at);
