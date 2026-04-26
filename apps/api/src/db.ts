import type { ChatRole, InterviewMode, Message, Session, SessionSummary } from "./types";

type SessionRow = {
  id: string;
  clientId: string;
  role: string;
  level: string;
  focus: string;
  companyName: string;
  cvText: string;
  jobDescription: string;
  interviewMode: InterviewMode;
  createdAt: string;
  updatedAt: string;
};

type MessageRow = {
  id: number;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
};

type SummaryRow = {
  sessionId: string;
  summary: string;
  strengths: string;
  improvementAreas: string;
  updatedAt: string;
};

export async function createSession(
  db: D1Database,
  input: Pick<Session, "clientId" | "role" | "level" | "focus" | "companyName" | "cvText" | "jobDescription" | "interviewMode">
) {
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO sessions (id, client_id, role, level, focus, company_name, cv_text, job_description, interview_mode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, input.clientId, input.role, input.level, input.focus, input.companyName, input.cvText, input.jobDescription, input.interviewMode)
    .run();

  await db
    .prepare(
      `INSERT INTO session_summaries (session_id, summary, strengths, improvement_areas)
       VALUES (?, '', '', '')`
    )
    .bind(id)
    .run();

  return id;
}

export async function listSessions(db: D1Database, clientId: string) {
  const result = await db
    .prepare(
      `SELECT id, client_id AS clientId, role, level, focus,
              company_name AS companyName, cv_text AS cvText,
              job_description AS jobDescription, interview_mode AS interviewMode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM sessions
       WHERE client_id = ?
       ORDER BY updated_at DESC`
    )
    .bind(clientId)
    .all<SessionRow>();

  return (result.results ?? []) satisfies Session[];
}

export async function getSession(db: D1Database, sessionId: string) {
  return await db
    .prepare(
      `SELECT id, client_id AS clientId, role, level, focus,
              company_name AS companyName, cv_text AS cvText,
              job_description AS jobDescription, interview_mode AS interviewMode,
              created_at AS createdAt, updated_at AS updatedAt
       FROM sessions
       WHERE id = ?`
    )
    .bind(sessionId)
    .first<SessionRow>();
}

export async function listMessages(db: D1Database, sessionId: string) {
  const result = await db
    .prepare(
      `SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at ASC, id ASC`
    )
    .bind(sessionId)
    .all<MessageRow>();

  return (result.results ?? []) satisfies Message[];
}

export async function listRecentMessages(
  db: D1Database,
  sessionId: string,
  limit = 12
) {
  const result = await db
    .prepare(
      `SELECT id, session_id AS sessionId, role, content, created_at AS createdAt
       FROM messages
       WHERE session_id = ?
       ORDER BY created_at DESC, id DESC
       LIMIT ?`
    )
    .bind(sessionId, limit)
    .all<MessageRow>();

  return [...(result.results ?? [])].reverse() satisfies Message[];
}

export async function addMessage(
  db: D1Database,
  sessionId: string,
  role: ChatRole,
  content: string
) {
  await db
    .prepare(
      `INSERT INTO messages (session_id, role, content)
       VALUES (?, ?, ?)`
    )
    .bind(sessionId, role, content)
    .run();

  await db
    .prepare(`UPDATE sessions SET updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
    .bind(sessionId)
    .run();
}

export async function getSummary(db: D1Database, sessionId: string) {
  return await db
    .prepare(
      `SELECT session_id AS sessionId, summary, strengths,
              improvement_areas AS improvementAreas, updated_at AS updatedAt
       FROM session_summaries
       WHERE session_id = ?`
    )
    .bind(sessionId)
    .first<SummaryRow>();
}

export async function upsertSummary(
  db: D1Database,
  summary: Pick<
    SessionSummary,
    "sessionId" | "summary" | "strengths" | "improvementAreas"
  >
) {
  await db
    .prepare(
      `INSERT INTO session_summaries
        (session_id, summary, strengths, improvement_areas, updated_at)
       VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id) DO UPDATE SET
        summary = excluded.summary,
        strengths = excluded.strengths,
        improvement_areas = excluded.improvement_areas,
        updated_at = CURRENT_TIMESTAMP`
    )
    .bind(
      summary.sessionId,
      summary.summary,
      summary.strengths,
      summary.improvementAreas
    )
    .run();
}

