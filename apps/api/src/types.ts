export type ChatRole = "user" | "assistant" | "system";

export interface Env {
  AI: Ai;
  DB: D1Database;
  AUTH_MODE?: "access" | "development";
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
}

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  authenticated: boolean;
}

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

export type RubricPreset =
  | "behavioral"
  | "technical"
  | "system_design"
  | "leadership"
  | "company_motivation"
  | "cybersecurity"
  | "project_defence";

export type InterviewerPersona = "supportive" | "realistic" | "strict";

export type InterviewDifficulty = "standard" | "challenging" | "senior";

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
  rubricPreset: RubricPreset;
  interviewPlan: InterviewPlan;
  interviewProgress: InterviewProgress;
  useCrossSessionMemory: boolean;
  interviewerPersona: InterviewerPersona;
  difficulty: InterviewDifficulty;
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

export interface UserCoachingMemory {
  userId: string;
  summary: string;
  recurringStrengths: string;
  recurringWeaknesses: string;
  recommendations: string;
  updatedAt: string;
}

export interface InterviewStage {
  id: string;
  label: string;
  objective: string;
  questionCount: number;
  enabled: boolean;
}

export interface InterviewPlan {
  stages: InterviewStage[];
}

export interface InterviewProgress {
  stageIndex: number;
  questionInStage: number;
  completed: boolean;
}

export interface SessionReport {
  id: string;
  sessionId: string;
  clientId: string;
  title: string;
  content: string;
  rubricPreset: RubricPreset;
  createdAt: string;
}
