import {
  addMessage,
  createSession,
  deleteSession,
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
import { HttpError, json, noContent, optionalString, readJson, requireString } from "./http";
import type { Env, InterviewMode, RubricResult, SessionType } from "./types";

function buildFirstQuestionInstruction(
  interviewMode: InterviewMode,
  companyName: string
): string {
  const company = companyName.trim() || "the target company";

  switch (interviewMode) {
    case "technical":
      return "Start the mock interview with exactly one practical technical question for the candidate's target role and level. If a CV or job description is provided, tailor it to their tech stack or the role's requirements. Focus on tradeoffs, implementation, or system behaviour. Do not score yet.";
    case "project_deep_dive":
      return "Start a project deep-dive interview. Based on the candidate's CV, choose their most relevant project and ask one specific probing question about it — e.g. architecture decisions, why they made a technical choice, or what they would improve. Do not score yet.";
    case "company_motivation":
      return `Start the mock interview with exactly one question about the candidate's motivation for applying to ${company}. Ask about their genuine interest in the company, role, or team. Do not score yet.`;
    case "weakness_gap":
      return "Start the mock interview with exactly one constructive question about a weakness or potential gap in the candidate's profile relevant to the target role. If a CV is provided, you may reference a possible growth area. Do not score yet.";
    case "final_simulation":
      return `Start a final-round interview simulation for ${company}. Ask exactly one challenging senior-level question — this could be a values alignment question, a leadership scenario, a strategic case, or a culture-fit question. Do not score yet.`;
    case "behavioural":
    default:
      return "Start the mock interview with exactly one focused behavioural question (STAR format expected). Base it on the candidate's target role, level, and CV if provided. Do not score yet.";
  }
}

function buildNextQuestionInstruction(
  interviewMode: InterviewMode,
  companyName: string
): string {
  const company = companyName.trim() || "the target company";

  switch (interviewMode) {
    case "technical":
      return "Continue the mock interview. Ask exactly one new technical question, building on prior answers or moving to another relevant technical area for the role. Avoid repeating earlier questions.";
    case "project_deep_dive":
      return "Continue the project deep-dive. Ask exactly one follow-up question that probes deeper into the candidate's described project — press on trade-offs, edge cases, production concerns, or lessons learned.";
    case "company_motivation":
      return `Continue the motivation-focused interview for ${company}. Ask one more question about company fit, culture alignment, or why this specific role appeals to the candidate.`;
    case "weakness_gap":
      return "Continue the weakness and gap exploration. Ask exactly one more question about a challenge, growth area, or gap relevant to the candidate's profile and target role.";
    case "final_simulation":
      return `Continue the final-round simulation for ${company}. Ask exactly one more challenging final-round question, varying the focus (e.g., move from leadership to values, or from strategy to culture).`;
    case "behavioural":
    default:
      return "Continue the mock interview. Ask exactly one new behavioural follow-up or next-stage question based on the candidate's role, level, CV, and prior answers. Avoid repeating earlier questions.";
  }
}

function formatRubricAsText(rubric: {
  scores: {
    relevance: number;
    specificity: number;
    technicalDepth: number;
    communicationClarity: number;
    evidenceExamples: number;
    overall: number;
  };
  strengths: string;
  weaknesses: string;
  improvedAnswer: string;
  followUpQuestion: string;
}): string {
  const { scores, strengths, weaknesses, improvedAnswer, followUpQuestion } = rubric;

  const pad = (label: string) => label.padEnd(24, " ");

  return [
    "📊 Rubric Score",
    "",
    `${pad("Relevance")}${scores.relevance}/10`,
    `${pad("Specificity")}${scores.specificity}/10`,
    `${pad("Technical depth")}${scores.technicalDepth}/10`,
    `${pad("Communication")}${scores.communicationClarity}/10`,
    `${pad("Evidence/examples")}${scores.evidenceExamples}/10`,
    "─".repeat(34),
    `${pad("Overall")}${scores.overall}/10`,
    "",
    "✅ What was strong",
    strengths,
    "",
    "⚠️ What to improve",
    weaknesses,
    "",
    "📝 Stronger answer",
    improvedAnswer,
    "",
    "❓ Likely follow-up",
    followUpQuestion
  ].join("\n");
}

type CreateSessionBody = {
  clientId?: unknown;
  role?: unknown;
  level?: unknown;
  focus?: unknown;
  cvText?: unknown;
  jobDescription?: unknown;
  companyName?: unknown;
  sessionType?: unknown;
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
  | "tailored_question"
  | "rubric_score"
  | "scorecard"
  | "improve_answer"
  | "rubric"
  | "generate_report";

const SESSION_TYPE_LABELS: Record<string, string> = {
  quick_practice: "Quick Practice",
  full_mock: "Full Mock Interview",
  project_defence: "Project Defence",
  technical_screen: "Technical Screen",
  company_specific: "Company-Specific"
};

function getSessionType(value: unknown): SessionType {
  if (
    value === "quick_practice" ||
    value === "full_mock" ||
    value === "project_defence" ||
    value === "technical_screen" ||
    value === "company_specific"
  ) {
    return value;
  }
  return "quick_practice";
}

function getInterviewMode(value: unknown): InterviewMode {
  if (
    value === "behavioural" ||
    value === "technical" ||
    value === "project_deep_dive" ||
    value === "company_motivation" ||
    value === "weakness_gap" ||
    value === "final_simulation"
  ) {
    return value;
  }
  return "behavioural";
}

function getChatAction(value: unknown): ChatAction {
  if (
    value === "first_question" ||
    value === "next_question" ||
    value === "technical_question" ||
    value === "tailored_question" ||
    value === "rubric_score" ||
    value === "scorecard" ||
    value === "improve_answer" ||
    value === "rubric" ||
    value === "generate_report"
  ) {
    return value;
  }

  return "message";
}

function buildActionInstruction(
  action: ChatAction,
  message: string,
  session?: { sessionType?: string; companyName?: string; interviewMode?: InterviewMode }
) {
  const interviewMode: InterviewMode = session?.interviewMode ?? "behavioural";
  const companyName = session?.companyName ?? "";

  if (action === "first_question") {
    return buildFirstQuestionInstruction(interviewMode, companyName);
  }

  if (action === "next_question") {
    return buildNextQuestionInstruction(interviewMode, companyName);
  }

  if (action === "technical_question") {
    return "Ask exactly one practical technical interview question relevant to the candidate's target role and level. Make it answerable in chat, realistic for the role, and focused on tradeoffs, debugging, implementation, or system behavior. Do not ask for code unless the role clearly calls for it.";
  }

  if (action === "tailored_question") {
    const company = session?.companyName ? ` at ${session.companyName}` : "";
    const sessionLabel =
      SESSION_TYPE_LABELS[session?.sessionType ?? "quick_practice"] ?? "interview";
    return (
      `Based on the candidate's CV and the job description provided, generate exactly one ` +
      `highly relevant interview question for the ${sessionLabel} session${company}. ` +
      `The question should directly reference the candidate's experience or the specific ` +
      `requirements in the job description.`
    );
  }

  if (action === "rubric_score") {
    return `Score the candidate's most recent answer using this rubric. Output in this exact format:

RUBRIC SCORE
────────────
Relevance:           /10
Specificity:         /10
Technical depth:     /10
Communication:       /10
Evidence/examples:   /10
────────────
Overall:             /10

Strengths: [one or two sentences]
Weaknesses: [one or two sentences]
Improved answer: [rewrite the answer in 3-4 sentences using STAR format with measurable impact]
Follow-up an interviewer might ask: [one realistic follow-up question]`;
  }

  if (action === "scorecard") {
    return "Give a concise interviewer scorecard based only on the candidate answers in this transcript. Include: overall readiness, strongest signal, biggest risk, and one drill to practice next. If evidence is thin, say so plainly.";
  }

  if (action === "improve_answer") {
    return `Rewrite the candidate's previous answer into a stronger interview answer using STAR format. Keep it natural, add measurable impact where possible, and explain the single strongest change. Previous answer: ${message}`;
  }

  if (action === "generate_report") {
    return `Generate a comprehensive final interview report for this session. Use this format:

FINAL SESSION REPORT
════════════════════

Overall Performance Score: /10

Best Answer: [quote or describe the candidate's strongest answer and why it worked]

Weakest Answer: [quote or describe the weakest answer and the key issue]

Repeated Issues: [list any patterns that came up across multiple answers]

STAR Improvements Suggested:
[list specific STAR format improvements for key answers]

Technical Depth Rating: /10
[brief commentary]

Confidence & Clarity Rating: /10
[brief commentary]

Next Practice Plan:
[3-5 specific, actionable steps the candidate should take before their next interview]`;
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
        const cvText = optionalString(body.cvText, "cvText", 8000);
        const jobDescription = optionalString(body.jobDescription, "jobDescription", 4000);
        const companyName = optionalString(body.companyName, "companyName");
        const sessionType = getSessionType(body.sessionType);
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
          cvText,
          jobDescription,
          companyName,
          sessionType,
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

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);

      if (sessionMatch && request.method === "DELETE") {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        const clientId = requireString(url.searchParams.get("clientId"), "clientId");
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== clientId) {
          throw new HttpError(404, "Session not found.");
        }

        await deleteSession(env.DB, sessionId);
        return noContent();
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
          (action === "scorecard" ||
            action === "rubric_score" ||
            action === "improve_answer" ||
            action === "rubric" ||
            action === "generate_report") &&
          !hasCandidateAnswer
        ) {
          return json({
            reply:
              "I need at least one candidate answer before I can do that. Answer the current interview question first, then I can score or improve it."
          });
        }

        // Structured rubric action: generate JSON score then store formatted text
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
            action === "message" ? undefined : buildActionInstruction(action, message, session)
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
