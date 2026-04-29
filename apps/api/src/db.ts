import type {
  ChatRole,
  InterviewMode,
  Message,
  Session,
  SessionSummary,
  SessionType
} from "./types";
import {
  getDefaultInterviewPlan,
  getInitialInterviewProgress,
  normalizeInterviewPlan,
  normalizeInterviewProgress
} from "./interviewPlan";

type SessionRow = {
  id: string;
  clientId: string;
  role: string;
  level: string;
  focus: string;
  cvText: string;
  jobDescription: string;
  companyName: string;
  sessionType: SessionType;
  interviewMode: InterviewMode;
  interviewPlan: string;
  interviewProgress: string;
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

function parseJson(value: string) {
  try {
    return value ? (JSON.parse(value) as unknown) : null;
  } catch {
    return null;
  }
}

function mapSessionRow(row: SessionRow): Session {
  const interviewPlan = normalizeInterviewPlan(
    parseJson(row.interviewPlan),
    row.sessionType
  );

  return {
    ...row,
    interviewPlan,
    interviewProgress: normalizeInterviewProgress(
      parseJson(row.interviewProgress),
      interviewPlan
    )
  };
}

function serializePlan(input: Pick<Session, "interviewPlan" | "sessionType">) {
  return JSON.stringify(
    input.interviewPlan ?? getDefaultInterviewPlan(input.sessionType)
  );
}

function serializeProgress(input?: Pick<Session, "interviewProgress">) {
  return JSON.stringify(input?.interviewProgress ?? getInitialInterviewProgress());
}

export async function upsertUser(
  db: D1Database,
  input: { id: string; email: string | null; name: string | null }
) {
  await db
    .prepare(
      `INSERT INTO users (id, email, name, last_seen_at)
       VALUES (?, ?, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(id) DO UPDATE SET
        email = excluded.email,
        name = excluded.name,
        last_seen_at = CURRENT_TIMESTAMP`
    )
    .bind(input.id, input.email, input.name)
    .run();
}

export async function createSession(
  db: D1Database,
  input: Pick<
    Session,
    | "clientId"
    | "role"
    | "level"
    | "focus"
    | "cvText"
    | "jobDescription"
    | "companyName"
    | "sessionType"
    | "interviewMode"
    | "interviewPlan"
  >
) {
  const id = crypto.randomUUID();

  await db
    .prepare(
      `INSERT INTO sessions
        (id, client_id, user_id, role, level, focus, cv_text, job_description,
         company_name, session_type, interview_mode, interview_plan, interview_progress)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      input.clientId,
      input.clientId,
      input.role,
      input.level,
      input.focus,
      input.cvText,
      input.jobDescription,
      input.companyName,
      input.sessionType,
      input.interviewMode,
      serializePlan(input),
      serializeProgress()
    )
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

export async function updateSession(
  db: D1Database,
  sessionId: string,
  input: Pick<
    Session,
    | "role"
    | "level"
    | "focus"
    | "cvText"
    | "jobDescription"
    | "companyName"
    | "sessionType"
    | "interviewMode"
    | "interviewPlan"
  >
) {
  await db
    .prepare(
      `UPDATE sessions
       SET role = ?,
           level = ?,
           focus = ?,
           cv_text = ?,
           job_description = ?,
           company_name = ?,
           session_type = ?,
           interview_mode = ?,
           interview_plan = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(
      input.role,
      input.level,
      input.focus,
      input.cvText,
      input.jobDescription,
      input.companyName,
      input.sessionType,
      input.interviewMode,
      serializePlan(input),
      sessionId
    )
    .run();
}

export async function deleteSession(db: D1Database, sessionId: string) {
  await db.prepare(`DELETE FROM sessions WHERE id = ?`).bind(sessionId).run();
}

export async function listSessions(db: D1Database, clientId: string) {
  const result = await db
    .prepare(
      `SELECT id, client_id AS clientId, role, level, focus,
              cv_text AS cvText, job_description AS jobDescription,
              company_name AS companyName, session_type AS sessionType,
              interview_mode AS interviewMode,
              interview_plan AS interviewPlan, interview_progress AS interviewProgress,
              created_at AS createdAt, updated_at AS updatedAt
       FROM sessions
       WHERE client_id = ?
       ORDER BY updated_at DESC`
    )
    .bind(clientId)
    .all<SessionRow>();

  return (result.results ?? []).map(mapSessionRow) satisfies Session[];
}

export async function getSession(db: D1Database, sessionId: string) {
  const row = await db
    .prepare(
      `SELECT id, client_id AS clientId, role, level, focus,
              cv_text AS cvText, job_description AS jobDescription,
              company_name AS companyName, session_type AS sessionType,
              interview_mode AS interviewMode,
              interview_plan AS interviewPlan, interview_progress AS interviewProgress,
              created_at AS createdAt, updated_at AS updatedAt
       FROM sessions
       WHERE id = ?`
    )
    .bind(sessionId)
    .first<SessionRow>();

  return row ? mapSessionRow(row) : null;
}

export async function updateInterviewProgress(
  db: D1Database,
  sessionId: string,
  progress: Session["interviewProgress"]
) {
  await db
    .prepare(
      `UPDATE sessions
       SET interview_progress = ?,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?`
    )
    .bind(JSON.stringify(progress), sessionId)
    .run();
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

export async function countUserMessages(db: D1Database, sessionId: string) {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS count
       FROM messages
       WHERE session_id = ? AND role = 'user'`
    )
    .bind(sessionId)
    .first<{ count: number }>();

  return row?.count ?? 0;
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
