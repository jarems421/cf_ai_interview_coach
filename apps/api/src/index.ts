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
  generateRubric,
  generateUpdatedSummary,
  shouldUpdateSummary
} from "./ai";
import { HttpError, json, noContent, readJson, requireString } from "./http";
import {
  buildFirstQuestionInstruction,
  buildNextQuestionInstruction,
  formatRubricAsText
} from "./prompts";
import type { Env, InterviewMode, RubricResult } from "./types";

type CreateSessionBody = {
  clientId?: unknown;
  role?: unknown;
  level?: unknown;
  focus?: unknown;
  companyName?: unknown;
  cvText?: unknown;
  jobDescription?: unknown;
  interviewMode?: unknown;
  turnstileToken?: unknown;
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
  | "improve_answer"
  | "rubric";

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
    value === "improve_answer" ||
    value === "rubric"
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

async function getAuthenticatedUserId(
  request: Request,
  env: Env
): Promise<string | null> {
  if (!env.CLERK_SECRET_KEY) {
    return null;
  }

  const authHeader = request.headers.get("Authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);

  try {
    const { verifyToken } = await import("@clerk/backend");
    const payload = await verifyToken(token, {
      secretKey: env.CLERK_SECRET_KEY
    });
    return (payload.sub as string | undefined) ?? null;
  } catch {
    return null;
  }
}

async function verifyTurnstileToken(
  token: string,
  secretKey: string
): Promise<boolean> {
  const form = new FormData();
  form.append("secret", secretKey);
  form.append("response", token);

  const response = await fetch(
    "https://challenges.cloudflare.com/turnstile/v0/siteverify",
    { method: "POST", body: form }
  );

  if (!response.ok) {
    return false;
  }

  const result = (await response.json()) as { success: boolean };
  return result.success === true;
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

      // Apply rate limiting to API endpoints when configured
      if (env.RATE_LIMITER && url.pathname.startsWith("/api/")) {
        const ip =
          request.headers.get("CF-Connecting-IP") ??
          request.headers.get("X-Forwarded-For") ??
          "unknown";
        const { success } = await env.RATE_LIMITER.limit({ key: ip });

        if (!success) {
          throw new HttpError(
            429,
            "Too many requests. Please wait a moment and try again."
          );
        }
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

        // Verify Turnstile token when configured
        if (env.TURNSTILE_SECRET_KEY) {
          const turnstileToken = requireString(
            body.turnstileToken,
            "turnstileToken"
          );
          const valid = await verifyTurnstileToken(
            turnstileToken,
            env.TURNSTILE_SECRET_KEY
          );

          if (!valid) {
            throw new HttpError(
              403,
              "Bot check failed. Please complete the verification and try again."
            );
          }
        }

        // When Clerk is configured, ensure the clientId matches the authenticated user
        if (env.CLERK_SECRET_KEY) {
          const userId = await getAuthenticatedUserId(request, env);

          if (!userId) {
            throw new HttpError(401, "Authentication required.");
          }

          if (userId !== clientId) {
            throw new HttpError(403, "Forbidden.");
          }
        }

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

        // When Clerk is configured, ensure the clientId matches the authenticated user
        if (env.CLERK_SECRET_KEY) {
          const userId = await getAuthenticatedUserId(request, env);

          if (!userId) {
            throw new HttpError(401, "Authentication required.");
          }

          if (userId !== clientId) {
            throw new HttpError(403, "Forbidden.");
          }
        }

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

        // When Clerk is configured, ensure the session belongs to the authenticated user
        if (env.CLERK_SECRET_KEY) {
          const userId = await getAuthenticatedUserId(request, env);

          if (!userId) {
            throw new HttpError(401, "Authentication required.");
          }

          if (userId !== session.clientId) {
            throw new HttpError(403, "Forbidden.");
          }
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

        // When Clerk is configured, ensure the session belongs to the authenticated user
        if (env.CLERK_SECRET_KEY) {
          const userId = await getAuthenticatedUserId(request, env);

          if (!userId) {
            throw new HttpError(401, "Authentication required.");
          }

          if (userId !== clientId) {
            throw new HttpError(403, "Forbidden.");
          }
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

        if (
          (action === "scorecard" || action === "improve_answer" || action === "rubric") &&
          !hasCandidateAnswer
        ) {
          return json({
            reply:
              "I need at least one candidate answer before I can do that. Answer the current interview question first, then I can score or improve it."
          });
        }

        // Rubric action: generate structured score then store formatted text
        if (action === "rubric") {
          const lastUserMsg = [...recentMessages]
            .reverse()
            .find((m) => m.role === "user");
          const lastAssistantMsg = [...recentMessages]
            .reverse()
            .find((m) => m.role === "assistant");

          let rubric: RubricResult;
          try {
            rubric = await generateRubric({
              ai: env.AI,
              answer: lastUserMsg?.content ?? "",
              question: lastAssistantMsg?.content ?? ""
            });
          } catch {
            return json({
              reply:
                "I wasn't able to generate a rubric score right now. Please try again."
            });
          }

          const reply = formatRubricAsText(rubric);
          await addMessage(env.DB, sessionId, "assistant", reply);
          return json({ reply, rubric });
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

