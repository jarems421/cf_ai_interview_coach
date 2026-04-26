export type ChatRole = "user" | "assistant" | "system";

export type InterviewMode =
  | "behavioural"
  | "technical"
  | "project_deep_dive"
  | "company_motivation"
  | "weakness_gap"
  | "final_simulation";

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
  companyName: string;
  cvText: string;
  jobDescription: string;
  interviewMode: InterviewMode;
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

