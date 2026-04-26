export type InterviewMode =
  | "behavioural"
  | "technical"
  | "project_deep_dive"
  | "company_motivation"
  | "weakness_gap"
  | "final_simulation";

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
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

