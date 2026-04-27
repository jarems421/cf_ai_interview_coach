ALTER TABLE sessions ADD COLUMN cv_text TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN job_description TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN company_name TEXT NOT NULL DEFAULT '';
ALTER TABLE sessions ADD COLUMN session_type TEXT NOT NULL DEFAULT 'quick_practice';
ALTER TABLE sessions ADD COLUMN interview_mode TEXT NOT NULL DEFAULT 'behavioural';
