ALTER TABLE sessions ADD COLUMN use_cross_session_memory INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sessions ADD COLUMN interviewer_persona TEXT NOT NULL DEFAULT 'realistic';
ALTER TABLE sessions ADD COLUMN difficulty TEXT NOT NULL DEFAULT 'standard';

CREATE TABLE IF NOT EXISTS user_coaching_memory (
  user_id TEXT PRIMARY KEY,
  summary TEXT NOT NULL DEFAULT '',
  recurring_strengths TEXT NOT NULL DEFAULT '',
  recurring_weaknesses TEXT NOT NULL DEFAULT '',
  recommendations TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
