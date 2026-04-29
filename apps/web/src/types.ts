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

export interface AuthUser {
  id: string;
  email: string | null;
  name: string | null;
  authenticated: boolean;
}

export interface AuthState {
  user: AuthUser;
  loginUrl: string;
  logoutUrl: string;
}

export interface Message {
  id: number;
  sessionId: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}
