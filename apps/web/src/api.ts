import type { InterviewMode, Message, RubricResult, Session, SessionType } from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

async function parseResponse<T>(response: Response): Promise<T> {
  let data: T & { error?: string };

  try {
    data = (await response.json()) as T & { error?: string };
  } catch {
    if (response.status === 429) {
      throw new Error("Rate limit reached. Please wait a moment and try again.");
    }
    throw new Error(`Request failed with status ${response.status}.`);
  }

  if (!response.ok) {
    if (response.status === 429) {
      throw new Error(
        data.error ?? "Rate limit reached. Please wait a moment and try again."
      );
    }
    if (response.status === 401) {
      throw new Error(data.error ?? "Authentication required. Please sign in.");
    }
    if (response.status === 403) {
      throw new Error(data.error ?? "Access denied.");
    }
    if (response.status >= 500) {
      throw new Error(
        data.error ??
          "The coach is thinking too hard right now. Please try again in a moment."
      );
    }
    throw new Error(data.error ?? "Request failed.");
  }

  return data;
}

function authHeaders(authToken?: string): Record<string, string> {
  if (authToken) {
    return { Authorization: `Bearer ${authToken}` };
  }
  return {};
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
  cvText?: string;
  jobDescription?: string;
  companyName?: string;
  sessionType?: SessionType;
  interviewMode?: InterviewMode;
  turnstileToken?: string;
  authToken?: string;
}) {
  const { authToken, ...body } = input;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${API_BASE}/api/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(authToken)
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    return parseResponse<{ sessionId: string }>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function listSessions(clientId: string, authToken?: string) {
  const params = new URLSearchParams({ clientId });
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(`${API_BASE}/api/sessions?${params}`, {
      headers: authHeaders(authToken),
      signal: controller.signal
    });
    return parseResponse<{ sessions: Session[] }>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function deleteSession(sessionId: string, clientId: string) {
  const params = new URLSearchParams({ clientId });
  const response = await fetch(`${API_BASE}/api/sessions/${sessionId}?${params}`, {
    method: "DELETE"
  });

  if (response.status === 204) {
    return;
  }

  return parseResponse<void>(response);
}

export async function listMessages(sessionId: string, authToken?: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10000);

  try {
    const response = await fetch(
      `${API_BASE}/api/sessions/${sessionId}/messages`,
      {
        headers: authHeaders(authToken),
        signal: controller.signal
      }
    );
    return parseResponse<{ messages: Message[] }>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("Request timed out. Please check your connection and try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
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
    | "rubric"
    | "generate_report";
  authToken?: string;
}) {
  const { authToken, ...body } = input;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60000);

  try {
    const response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...authHeaders(authToken)
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });

    return parseResponse<{ reply: string; rubric?: RubricResult }>(response);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The coach took too long to respond. Please try again.");
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
