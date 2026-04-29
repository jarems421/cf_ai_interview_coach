CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT,
  name TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE sessions ADD COLUMN user_id TEXT;

UPDATE sessions
SET user_id = client_id
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
  ON sessions (user_id, updated_at DESC);
