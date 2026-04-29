ALTER TABLE sessions ADD COLUMN rubric_preset TEXT NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS session_reports (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  rubric_preset TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (client_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_reports_session_id
  ON session_reports(session_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_session_reports_client_id
  ON session_reports(client_id, created_at DESC);
