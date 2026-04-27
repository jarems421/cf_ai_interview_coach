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
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
