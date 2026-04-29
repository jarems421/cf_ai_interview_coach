import type {
  AuthState,
  InterviewMode,
  InterviewPlan,
  Message,
  ResumeExtractResult,
  Session,
  SessionType
} from "./types";

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "";

function isHtmlResponse(contentType: string | null, body: string) {
  const trimmed = body.trim().toLowerCase();
  return (
    contentType?.toLowerCase().includes("text/html") ||
    trimmed.startsWith("<!doctype html") ||
    trimmed.startsWith("<html")
  );
}

export async function parseResponse<T>(response: Response): Promise<T> {
  const body = await response.text();
  const contentType = response.headers.get("Content-Type");

  if (isHtmlResponse(contentType, body)) {
    throw new Error(
      "The API returned a sign-in page instead of app data. The live Worker route is probably still protected by Cloudflare Access."
    );
  }

  let data: (T & { error?: string }) | null = null;
  try {
    data = body ? (JSON.parse(body) as T & { error?: string }) : null;
  } catch {
    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    throw new Error("The API returned an unreadable response. Please try again.");
  }

  if (!response.ok) {
    throw new Error(data?.error ?? "Request failed.");
  }

  if (data === null) {
    throw new Error("The API returned an empty response. Please try again.");
  }

  return data;
}

async function requestJson<T>(input: RequestInfo | URL, init?: RequestInit) {
  try {
    const response = await fetch(input, init);
    return await parseResponse<T>(response);
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach the API. Check the Worker URL, CORS settings, and whether Cloudflare Access is blocking the request."
      );
    }

    throw error;
  }
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
  return requestJson<AuthState>(`${API_BASE}/api/me?${params}`, {
    credentials: "include"
  });
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
  interviewPlan?: InterviewPlan;
}) {
  return requestJson<{ sessionId: string }>(`${API_BASE}/api/sessions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
}

export async function listSessions(clientId: string) {
  const params = new URLSearchParams({ clientId });
  return requestJson<{ sessions: Session[] }>(`${API_BASE}/api/sessions?${params}`, {
    credentials: "include"
  });
}

export async function listMessages(clientId: string, sessionId: string) {
  const params = new URLSearchParams({ clientId });
  return requestJson<{ messages: Message[] }>(
    `${API_BASE}/api/sessions/${sessionId}/messages?${params}`,
    { credentials: "include" }
  );
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
  interviewPlan?: InterviewPlan;
}) {
  return requestJson<{ ok: true }>(
    `${API_BASE}/api/sessions/${input.sessionId}`,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: JSON.stringify(input)
    }
  );
}

export async function extractResume(input: { clientId: string; file: File }) {
  const formData = new FormData();
  formData.append("clientId", input.clientId);
  formData.append("file", input.file);

  return requestJson<ResumeExtractResult>(`${API_BASE}/api/resume/extract`, {
    method: "POST",
    credentials: "include",
    body: formData
  });
}

export async function deleteSession(clientId: string, sessionId: string) {
  const params = new URLSearchParams({ clientId });
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/api/sessions/${sessionId}?${params}`, {
      method: "DELETE",
      credentials: "include"
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach the API. Check the Worker URL, CORS settings, and whether Cloudflare Access is blocking the request."
      );
    }

    throw error;
  }

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
  return requestJson<{ reply: string }>(`${API_BASE}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify(input)
  });
}

export async function streamChatMessage(
  input: {
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
  },
  onDelta: (text: string) => void
) {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/api/chat`, {
      method: "POST",
      headers: {
        Accept: "text/event-stream",
        "Content-Type": "application/json"
      },
      credentials: "include",
      body: JSON.stringify({ ...input, stream: true })
    });
  } catch (error) {
    if (error instanceof TypeError) {
      throw new Error(
        "Could not reach the API. Check the Worker URL, CORS settings, and whether Cloudflare Access is blocking the request."
      );
    }

    throw error;
  }

  const contentType = response.headers.get("Content-Type");
  if (!response.ok || !contentType?.includes("text/event-stream")) {
    const result = await parseResponse<{ reply: string }>(response);
    onDelta(result.reply);
    return result;
  }

  if (!response.body) {
    throw new Error("The API did not open a streaming response.");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let reply = "";
  let doneReply = "";
  let streamError = "";

  function consumeEvent(eventText: string) {
    const eventName =
      eventText
        .split(/\r?\n/)
        .find((line) => line.startsWith("event:"))
        ?.slice(6)
        .trim() ?? "message";
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!data) {
      return;
    }

    const parsed = JSON.parse(data) as Partial<{ text: string; reply: string; error: string }>;

    if (eventName === "delta" && typeof parsed.text === "string") {
      reply += parsed.text;
      onDelta(parsed.text);
    } else if (eventName === "done" && typeof parsed.reply === "string") {
      doneReply = parsed.reply;
    } else if (eventName === "error") {
      streamError = parsed.error ?? "Could not stream the coaching reply.";
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundaryMatch = /\r?\n\r?\n/.exec(buffer);
    while (boundaryMatch) {
      const eventText = buffer.slice(0, boundaryMatch.index);
      buffer = buffer.slice(boundaryMatch.index + boundaryMatch[0].length);
      consumeEvent(eventText);
      boundaryMatch = /\r?\n\r?\n/.exec(buffer);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeEvent(buffer);
  }

  if (streamError) {
    throw new Error(streamError);
  }

  return { reply: doneReply || reply };
}
