import type {
  AuthState,
  InterviewMode,
  Message,
  Session,
  SessionType
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  let data: (T & { error?: string }) | null = null;

  try {
    data = (await response.json()) as T & { error?: string };
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    throw new Error("Response was not valid JSON.");
  }

  if (!response.ok) {
    throw new Error(data?.error ?? "Request failed.");
  }

  return data;
}

export function getClientId() {
  const storageKey = "cf_ai_interview_coach_client_id";
  const existing = localStorage.getItem(storageKey);

  if (existing) {
    return existing;
  }

  const next = crypto.randomUUID();
  localStorage.setItem(storageKey, next);
  return next;
}

export async function getCurrentUser(clientId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`${API_BASE}/api/me?${params}`, {
    credentials: "include"
  });
  return parseResponse<AuthState>(response);
}

export async function createSession(input: {
  clientId: string;
  role: string;
  level: string;
  focus: string;
  cvText?: string;
  jobDescription?: string;
  companyName?: string;
  sessionType?: SessionType;
  interviewMode?: InterviewMode;
}) {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });

  return parseResponse<{ sessionId: string }>(response);
}

export async function listSessions(clientId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`${API_BASE}/api/sessions?${params}`, {
    credentials: "include"
  });
  return parseResponse<{ sessions: Session[] }>(response);
}

export async function listMessages(clientId: string, sessionId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(
    `${API_BASE}/api/sessions/${sessionId}/messages?${params}`,
    { credentials: "include" }
  );
  return parseResponse<{ messages: Message[] }>(response);
}

export async function updateSession(input: {
  clientId: string;
  sessionId: string;
  role: string;
  level: string;
  focus: string;
  cvText?: string;
  jobDescription?: string;
  companyName?: string;
  sessionType?: SessionType;
  interviewMode?: InterviewMode;
}) {
  const response = await fetch(`${API_BASE}/api/sessions/${input.sessionId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });

  return parseResponse<{ ok: true }>(response);
}

export async function deleteSession(clientId: string, sessionId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(
    `${API_BASE}/api/sessions/${sessionId}?${params}`,
    {
      method: "DELETE",
      credentials: "include"
    }
  );

  if (response.status === 204) {
    return { ok: true };
  }

  return parseResponse<{ ok: true }>(response);
}

export async function sendChatMessage(input: {
  clientId: string;
  sessionId: string;
  message: string;
  action?:
    | "message"
    | "first_question"
    | "next_question"
    | "technical_question"
    | "tailored_question"
    | "rubric_score"
    | "scorecard"
    | "improve_answer"
    | "generate_report";
}) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });

  return parseResponse<{ reply: string }>(response);
}
