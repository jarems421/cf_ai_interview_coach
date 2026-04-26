import {
  addMessage,
  createSession,
  getSession,
  getSummary,
  listMessages,
  listRecentMessages,
  listSessions,
  upsertSummary
} from "./db";
import {
  generateCoachReply,
  generateUpdatedSummary,
  shouldUpdateSummary
} from "./ai";
import { HttpError, json, noContent, readJson, requireString } from "./http";
import {
  buildFirstQuestionInstruction,
  buildNextQuestionInstruction
} from "./prompts";
import type { Env, InterviewMode } from "./types";

type CreateSessionBody = {
  clientId?: unknown;
  role?: unknown;
  level?: unknown;
  focus?: unknown;
  companyName?: unknown;
  cvText?: unknown;
  jobDescription?: unknown;
  interviewMode?: unknown;
};

type ChatBody = {
  clientId?: unknown;
  sessionId?: unknown;
  message?: unknown;
  action?: unknown;
};

type ChatAction =
  | "message"
  | "first_question"
  | "next_question"
  | "technical_question"
  | "scorecard"
  | "improve_answer";

const VALID_INTERVIEW_MODES: InterviewMode[] = [
  "behavioural",
  "technical",
  "project_deep_dive",
  "company_motivation",
  "weakness_gap",
  "final_simulation"
];

function getInterviewMode(value: unknown): InterviewMode {
  if (typeof value === "string" && (VALID_INTERVIEW_MODES as string[]).includes(value)) {
    return value as InterviewMode;
  }
  return "behavioural";
}

function getChatAction(value: unknown): ChatAction {
  if (
    value === "first_question" ||
    value === "next_question" ||
    value === "technical_question" ||
    value === "scorecard" ||
    value === "improve_answer"
  ) {
    return value;
  }

  return "message";
}

function buildActionInstruction(
  action: ChatAction,
  message: string,
  interviewMode: InterviewMode,
  companyName: string
) {
  if (action === "first_question") {
    return buildFirstQuestionInstruction(interviewMode, companyName);
  }

  if (action === "next_question") {
    return buildNextQuestionInstruction(interviewMode, companyName);
  }

  if (action === "technical_question") {
    return "Ask exactly one practical technical interview question relevant to the candidate's target role and level. Make it answerable in chat, realistic for the role, and focused on tradeoffs, debugging, implementation, or system behavior. Do not ask for code unless the role clearly calls for it.";
  }

  if (action === "scorecard") {
    return "Give a concise interviewer scorecard based only on the candidate answers in this transcript. Include: overall readiness, strongest signal, biggest risk, and one drill to practice next. If evidence is thin, say so plainly.";
  }

  if (action === "improve_answer") {
    return `Rewrite the candidate's previous answer into a stronger interview answer using STAR format. Keep it natural, add measurable impact where possible, and explain the single strongest change. Previous answer: ${message}`;
  }

  return message;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return noContent();
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "cf_ai_interview_coach" });
      }

      if (url.pathname === "/api/sessions" && request.method === "POST") {
        const body = await readJson<CreateSessionBody>(request);
        const clientId = requireString(body.clientId, "clientId");
        const role = requireString(body.role, "role");
        const level = requireString(body.level, "level");
        const focus = requireString(body.focus, "focus");
        const companyName =
          typeof body.companyName === "string" ? body.companyName.trim().slice(0, 120) : "";
        const cvText =
          typeof body.cvText === "string" ? body.cvText.trim().slice(0, 6000) : "";
        const jobDescription =
          typeof body.jobDescription === "string"
            ? body.jobDescription.trim().slice(0, 4000)
            : "";
        const interviewMode = getInterviewMode(body.interviewMode);

        const sessionId = await createSession(env.DB, {
          clientId,
          role,
          level,
          focus,
          companyName,
          cvText,
          jobDescription,
          interviewMode
        });

        return json({ sessionId }, { status: 201 });
      }

      if (url.pathname === "/api/sessions" && request.method === "GET") {
        const clientId = requireString(url.searchParams.get("clientId"), "clientId");
        return json({ sessions: await listSessions(env.DB, clientId) });
      }

      const messagesMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/messages$/
      );

      if (messagesMatch && request.method === "GET") {
        const sessionId = decodeURIComponent(messagesMatch[1]);
        const session = await getSession(env.DB, sessionId);

        if (!session) {
          throw new HttpError(404, "Session not found.");
        }

        return json({ messages: await listMessages(env.DB, sessionId) });
      }

      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await readJson<ChatBody>(request);
        const clientId = requireString(body.clientId, "clientId");
        const sessionId = requireString(body.sessionId, "sessionId");
        const action = getChatAction(body.action);
        const message =
          action === "message" || action === "improve_answer"
            ? requireString(body.message, "message", 2000)
            : "";
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== clientId) {
          throw new HttpError(404, "Session not found.");
        }

        if (action === "message") {
          await addMessage(env.DB, sessionId, "user", message);
        }

        const [summary, recentMessages] = await Promise.all([
          getSummary(env.DB, sessionId),
          listRecentMessages(env.DB, sessionId)
        ]);

        const hasCandidateAnswer = recentMessages.some(
          (recentMessage) => recentMessage.role === "user"
        );

        if ((action === "scorecard" || action === "improve_answer") && !hasCandidateAnswer) {
          return json({
            reply:
              "I need at least one candidate answer before I can do that. Answer the current interview question first, then I can score or improve it."
          });
        }

        const reply = await generateCoachReply({
          ai: env.AI,
          session,
          summary,
          messages: recentMessages,
          instruction:
            action === "message"
              ? undefined
              : buildActionInstruction(
                  action,
                  message,
                  session.interviewMode ?? "behavioural",
                  session.companyName ?? ""
                )
        });

        await addMessage(env.DB, sessionId, "assistant", reply);

        const updatedRecentMessages = [
          ...recentMessages,
          {
            id: Number.MAX_SAFE_INTEGER,
            sessionId,
            role: "assistant" as const,
            content: reply,
            createdAt: new Date().toISOString()
          }
        ];

        if (shouldUpdateSummary(updatedRecentMessages)) {
          try {
            const updatedSummary = await generateUpdatedSummary({
              ai: env.AI,
              current: summary,
              messages: updatedRecentMessages
            });

            await upsertSummary(env.DB, {
              sessionId,
              ...updatedSummary
            });
          } catch (summaryError) {
            console.warn("Summary update skipped", summaryError);
          }
        }

        return json({ reply });
      }

      return json({ error: "Not found" }, { status: 404 });
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, { status: error.status });
      }

      console.error(error);
      return json(
        { error: "Something went wrong. Please try again." },
        { status: 500 }
      );
    }
  }
};
