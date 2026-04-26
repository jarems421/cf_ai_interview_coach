export type ChatRole = "user" | "assistant" | "system";

export interface Env {
  AI: Ai;
  DB: D1Database;
}

export interface Session {
  id: string;
  clientId: string;
  role: string;
  level: string;
  focus: string;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: number;
  sessionId: string;
  role: ChatRole;
  content: string;
  createdAt: string;
}

export interface SessionSummary {
  sessionId: string;
  summary: string;
  strengths: string;
  improvementAreas: string;
  updatedAt: string;
}

