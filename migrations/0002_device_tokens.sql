-- Chappy device token table for the development environment.
-- Apply this migration only to the isolated development D1 database.
-- Do not copy production device tokens into this database.

CREATE TABLE IF NOT EXISTS device_tokens (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  revoked_at TEXT,
  label TEXT
);
