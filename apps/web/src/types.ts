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
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
}

