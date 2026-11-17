-- Chappy admin sessions
-- Apply only to the isolated TEST D1 database first.
-- Never apply this migration to production until explicitly approved.

CREATE TABLE IF NOT EXISTS admin_sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_token_hash
  ON admin_sessions(token_hash);

CREATE INDEX IF NOT EXISTS idx_admin_sessions_expires_at
  ON admin_sessions(expires_at);
