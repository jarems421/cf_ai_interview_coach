-- Add user_id column to associate sessions with authenticated Clerk users.
-- Nullable for backwards compatibility with anonymous (localStorage) sessions.
ALTER TABLE sessions ADD COLUMN user_id TEXT;

CREATE INDEX IF NOT EXISTS idx_sessions_user_updated
  ON sessions (user_id, updated_at DESC);
