import {
  addMessage,
  countUserMessages,
  createSession,
  deleteSession,
  getSession,
  getSummary,
  listMessages,
  listRecentMessages,
  listSessions,
  updateSession,
  upsertSummary,
  upsertUser
} from "./db";
import { getAuthLinks, getRequestUser } from "./auth";
import {
  consumeAiEventStream,
  generateCoachReply,
  generateCoachReplyStream,
  generateUpdatedSummary,
  shouldUpdateSummary
} from "./ai";
import {
  corsHeaders,
  HttpError,
  json,
  noContent,
  optionalString,
  readJson,
  requireString
} from "./http";
import type {
  Env,
  InterviewMode,
  Message,
  Session,
  SessionSummary,
  SessionType
} from "./types";

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
};

type ChatBody = {
  clientId?: unknown;
  sessionId?: unknown;
  message?: unknown;
  action?: unknown;
  stream?: unknown;
};

type UpdateSessionBody = {
  clientId?: unknown;
  role?: unknown;
  level?: unknown;
  focus?: unknown;
  cvText?: unknown;
  jobDescription?: unknown;
  companyName?: unknown;
  sessionType?: unknown;
  interviewMode?: unknown;
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
  | "generate_report";

const chatRateLimitWindowMs = 60_000;
const chatRateLimitMaxRequests = 30;
const chatRateLimits = new Map<string, { count: number; resetAt: number }>();

export function assertChatRateLimit(userId: string, now = Date.now()) {
  const current = chatRateLimits.get(userId);

  if (!current || current.resetAt <= now) {
    chatRateLimits.set(userId, {
      count: 1,
      resetAt: now + chatRateLimitWindowMs
    });
    return;
  }

  if (current.count >= chatRateLimitMaxRequests) {
    const retrySeconds = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
    throw new HttpError(
      429,
      `Too many coaching requests. Try again in ${retrySeconds} seconds.`
    );
  }

  current.count += 1;
}

export function resetChatRateLimitsForTest() {
  chatRateLimits.clear();
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
    value === "generate_report"
  ) {
    return value;
  }

  return "message";
}

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

export function buildActionInstruction(
  action: ChatAction,
  message: string,
  session?: { sessionType?: string; companyName?: string }
) {
  if (action === "first_question") {
    return "Start the mock interview by asking exactly one focused opening question for the candidate's target role and level. Do not score the candidate yet.";
  }

  if (action === "next_question") {
    return "Continue the mock interview like a real interviewer. Ask exactly one new follow-up or next-stage question based on the candidate's target role, level, focus area, and prior answers. Avoid repeating earlier questions.";
  }

  if (action === "technical_question") {
    return "Ask exactly one practical technical interview question relevant to the candidate's target role and level. Make it a realistic scenario, not trivia. It should be answerable in chat and test reasoning about constraints, implementation approach, debugging signals, edge cases, system behavior, and tradeoffs. Include enough context for the candidate to reason, but do not provide the answer.";
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
------------
Relevance:           /10
Specificity:         /10
Technical depth:     /10
Communication:       /10
Evidence/examples:   /10
------------
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
====================

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

function wantsStream(request: Request, body: ChatBody) {
  return (
    body.stream === true ||
    request.headers.get("Accept")?.includes("text/event-stream") === true
  );
}

function writeSse(
  controller: ReadableStreamDefaultController<Uint8Array>,
  event: string,
  data: unknown
) {
  controller.enqueue(
    new TextEncoder().encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  );
}

function eventStreamResponse(
  request: Request,
  stream: ReadableStream<Uint8Array>
) {
  return new Response(stream, {
    headers: {
      ...corsHeaders(request),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform"
    }
  });
}

function streamStaticReply(request: Request, reply: string) {
  return eventStreamResponse(
    request,
    new ReadableStream<Uint8Array>({
      start(controller) {
        writeSse(controller, "delta", { text: reply });
        writeSse(controller, "done", { reply });
        controller.close();
      }
    })
  );
}

async function maybeUpdateSummary(input: {
  env: Env;
  action: ChatAction;
  sessionId: string;
  summary: SessionSummary | null;
  recentMessages: Message[];
  reply: string;
}) {
  const updatedRecentMessages = [
    ...input.recentMessages,
    {
      id: Number.MAX_SAFE_INTEGER,
      sessionId: input.sessionId,
      role: "assistant" as const,
      content: input.reply,
      createdAt: new Date().toISOString()
    }
  ];

  const userTurnCount =
    input.action === "message"
      ? await countUserMessages(input.env.DB, input.sessionId)
      : 0;

  if (!shouldUpdateSummary(userTurnCount)) {
    return;
  }

  try {
    const updatedSummary = await generateUpdatedSummary({
      ai: input.env.AI,
      current: input.summary,
      messages: updatedRecentMessages
    });

    await upsertSummary(input.env.DB, {
      sessionId: input.sessionId,
      ...updatedSummary
    });
  } catch (summaryError) {
    console.warn("Summary update skipped", summaryError);
  }
}

function streamCoachReply(input: {
  request: Request;
  env: Env;
  sessionId: string;
  session: Session;
  summary: SessionSummary | null;
  recentMessages: Message[];
  action: ChatAction;
  instruction?: string;
}) {
  return eventStreamResponse(
    input.request,
    new ReadableStream<Uint8Array>({
      async start(controller) {
        let reply = "";

        try {
          const aiStream = await generateCoachReplyStream({
            ai: input.env.AI,
            session: input.session,
            summary: input.summary,
            messages: input.recentMessages,
            instruction: input.instruction
          });

          await consumeAiEventStream(aiStream, (text) => {
            reply += text;
            writeSse(controller, "delta", { text });
          });

          const trimmedReply = reply.trim();
          if (!trimmedReply) {
            throw new Error("Workers AI returned an empty response.");
          }

          await addMessage(input.env.DB, input.sessionId, "assistant", trimmedReply);
          await maybeUpdateSummary({
            env: input.env,
            action: input.action,
            sessionId: input.sessionId,
            summary: input.summary,
            recentMessages: input.recentMessages,
            reply: trimmedReply
          });

          writeSse(controller, "done", { reply: trimmedReply });
        } catch (error) {
          writeSse(controller, "error", {
            error:
              error instanceof Error
                ? error.message
                : "Could not stream the coaching reply."
          });
        } finally {
          controller.close();
        }
      }
    })
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (request.method === "OPTIONS") {
      return noContent(request);
    }

    try {
      const url = new URL(request.url);

      if (url.pathname === "/api/health") {
        return json({ ok: true, service: "cf_ai_interview_coach" }, {}, request);
      }

      if (url.pathname === "/api/me") {
        const clientId = url.searchParams.get("clientId");
        const user = await getRequestUser(request, env, clientId);
        await upsertUser(env.DB, user);

        return json({ user, ...getAuthLinks(env) }, {}, request);
      }

      if (url.pathname === "/api/sessions" && request.method === "POST") {
        const body = await readJson<CreateSessionBody>(request);
        const user = await getRequestUser(request, env, body.clientId);
        await upsertUser(env.DB, user);
        const role = requireString(body.role, "role");
        const level = requireString(body.level, "level");
        const focus = requireString(body.focus, "focus");
        const cvText = optionalString(body.cvText, "cvText", 8000);
        const jobDescription = optionalString(
          body.jobDescription,
          "jobDescription",
          4000
        );
        const companyName = optionalString(body.companyName, "companyName");
        const sessionType = getSessionType(body.sessionType);
        const interviewMode = getInterviewMode(body.interviewMode);

        const sessionId = await createSession(env.DB, {
          clientId: user.id,
          role,
          level,
          focus,
          cvText,
          jobDescription,
          companyName,
          sessionType,
          interviewMode
        });

        return json({ sessionId }, { status: 201 }, request);
      }

      if (url.pathname === "/api/sessions" && request.method === "GET") {
        const user = await getRequestUser(
          request,
          env,
          url.searchParams.get("clientId")
        );
        await upsertUser(env.DB, user);
        return json({ sessions: await listSessions(env.DB, user.id) }, {}, request);
      }

      const sessionMatch = url.pathname.match(/^\/api\/sessions\/([^/]+)$/);

      if (sessionMatch && request.method === "PATCH") {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        const body = await readJson<UpdateSessionBody>(request);
        const user = await getRequestUser(request, env, body.clientId);
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== user.id) {
          throw new HttpError(404, "Session not found.");
        }

        const role = requireString(body.role, "role");
        const level = requireString(body.level, "level");
        const focus = requireString(body.focus, "focus");
        const cvText = optionalString(body.cvText, "cvText", 8000);
        const jobDescription = optionalString(
          body.jobDescription,
          "jobDescription",
          4000
        );
        const companyName = optionalString(body.companyName, "companyName");
        const sessionType = getSessionType(body.sessionType);
        const interviewMode = getInterviewMode(body.interviewMode);

        await updateSession(env.DB, sessionId, {
          role,
          level,
          focus,
          cvText,
          jobDescription,
          companyName,
          sessionType,
          interviewMode
        });
        return json({ ok: true }, {}, request);
      }

      if (sessionMatch && request.method === "DELETE") {
        const sessionId = decodeURIComponent(sessionMatch[1]);
        const user = await getRequestUser(
          request,
          env,
          url.searchParams.get("clientId")
        );
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== user.id) {
          throw new HttpError(404, "Session not found.");
        }

        await deleteSession(env.DB, sessionId);
        return noContent(request);
      }

      const messagesMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/messages$/
      );

      if (messagesMatch && request.method === "GET") {
        const sessionId = decodeURIComponent(messagesMatch[1]);
        const user = await getRequestUser(
          request,
          env,
          url.searchParams.get("clientId")
        );
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== user.id) {
          throw new HttpError(404, "Session not found.");
        }

        return json(
          { messages: await listMessages(env.DB, sessionId) },
          {},
          request
        );
      }

      if (url.pathname === "/api/chat" && request.method === "POST") {
        const body = await readJson<ChatBody>(request);
        const streamRequested = wantsStream(request, body);
        const user = await getRequestUser(request, env, body.clientId);
        assertChatRateLimit(user.id);
        const sessionId = requireString(body.sessionId, "sessionId");
        const action = getChatAction(body.action);
        const message =
          action === "message" || action === "improve_answer"
            ? requireString(body.message, "message", 2000)
            : "";
        const session = await getSession(env.DB, sessionId);

        if (!session || session.clientId !== user.id) {
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

        if (
          (action === "scorecard" ||
            action === "rubric_score" ||
            action === "improve_answer" ||
            action === "generate_report") &&
          !hasCandidateAnswer
        ) {
          const reply =
            "I need at least one candidate answer before I can do that. Answer the current interview question first, then I can score or improve it.";

          return streamRequested
            ? streamStaticReply(request, reply)
            : json({ reply }, {}, request);
        }

        const instruction =
          action === "message"
            ? undefined
            : buildActionInstruction(action, message, session);

        if (streamRequested) {
          return streamCoachReply({
            request,
            env,
            sessionId,
            session,
            summary,
            recentMessages,
            action,
            instruction
          });
        }

        const reply = await generateCoachReply({
          ai: env.AI,
          session,
          summary,
          messages: recentMessages,
          instruction
        });

        await addMessage(env.DB, sessionId, "assistant", reply);
        await maybeUpdateSummary({
          env,
          action,
          sessionId,
          summary,
          recentMessages,
          reply
        });

        return json({ reply }, {}, request);
      }

      return json({ error: "Not found" }, { status: 404 }, request);
    } catch (error) {
      if (error instanceof HttpError) {
        return json({ error: error.message }, { status: error.status }, request);
      }

      console.error(error);
      return json(
        { error: "Something went wrong. Please try again." },
        { status: 500 },
        request
      );
    }
  }
};
