import type { Message, Session } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  const data = (await response.json()) as T & { error?: string };

  if (!response.ok) {
    throw new Error(data.error ?? "Request failed.");
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

export async function createSession(input: {
  clientId: string;
  role: string;
  level: string;
  focus: string;
  companyName?: string;
  cvText?: string;
  jobDescription?: string;
  interviewMode?: string;
}) {
  const response = await fetch(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseResponse<{ sessionId: string }>(response);
}

export async function listSessions(clientId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`${API_BASE}/api/sessions?${params}`);
  return parseResponse<{ sessions: Session[] }>(response);
}

export async function listMessages(sessionId: string) {
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}/messages`);
  return parseResponse<{ messages: Message[] }>(response);
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
    | "scorecard"
    | "improve_answer";
}) {
  const response = await fetch(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input)
  });

  return parseResponse<{ reply: string }>(response);
}
