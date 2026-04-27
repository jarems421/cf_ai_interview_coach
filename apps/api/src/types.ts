export type ChatRole = "user" | "assistant" | "system";

export type SessionType =
  | "quick_practice"
  | "full_mock"
  | "project_defence"
  | "technical_screen"
  | "company_specific";

export type InterviewMode =
  | "behavioural"
  | "technical"
  | "project_deep_dive"
  | "company_motivation"
  | "weakness_gap"
  | "final_simulation";

export interface RubricScore {
  relevance: number;
  specificity: number;
  technicalDepth: number;
  communicationClarity: number;
  evidenceExamples: number;
  overall: number;
}

export interface RubricResult {
  scores: RubricScore;
  strengths: string;
  weaknesses: string;
  improvedAnswer: string;
  followUpQuestion: string;
}

export interface Env {
  AI: Ai;
  DB: D1Database;
  CLERK_SECRET_KEY?: string;
  TURNSTILE_SECRET_KEY?: string;
  RATE_LIMITER?: {
    limit: (options: { key: string }) => Promise<{ success: boolean }>;
  };
}

export interface Session {
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
