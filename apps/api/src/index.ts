import {
  addMessage,
  countUserMessages,
  createSessionReport,
  createSession,
  deleteSession,
  getSession,
  getSummary,
  getUserCoachingMemory,
  listClientReports,
  listMessages,
  listRecentMessages,
  listSessionReports,
  listSessions,
  updateInterviewProgress,
  updateSession,
  upsertSummary,
  upsertUser,
  upsertUserCoachingMemory
} from "./db";
import {
  advanceInterviewProgress,
  buildStageInstruction,
  normalizeInterviewPlan,
  shouldAdvanceProgress
} from "./interviewPlan";
import { getAuthLinks, getRequestUser } from "./auth";
import {
  consumeAiEventStream,
  generateCoachReply,
  generateCoachReplyStream,
  generateUpdatedSummary,
  generateUpdatedUserMemory,
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
import { extractResumeFile } from "./resume";
import { getSessionRubric, normalizeRubricPreset } from "./rubrics";
import type {
  Env,
  InterviewDifficulty,
  InterviewMode,
  InterviewProgress,
  InterviewerPersona,
  Message,
  Session,
  SessionSummary,
  SessionType,
  UserCoachingMemory
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
  rubricPreset?: unknown;
  interviewPlan?: unknown;
  useCrossSessionMemory?: unknown;
  interviewerPersona?: unknown;
  difficulty?: unknown;
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
  rubricPreset?: unknown;
  interviewPlan?: unknown;
  useCrossSessionMemory?: unknown;
  interviewerPersona?: unknown;
  difficulty?: unknown;
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

function getInterviewerPersona(value: unknown): InterviewerPersona {
  if (value === "supportive" || value === "strict") {
    return value;
  }

  return "realistic";
}

function getInterviewDifficulty(value: unknown): InterviewDifficulty {
  if (value === "challenging" || value === "senior") {
    return value;
  }

  return "standard";
}

function getBoolean(value: unknown) {
  return value === true || value === 1 || value === "true";
}

export function buildActionInstruction(
  action: ChatAction,
  message: string,
  session?: Session
) {
  const stageInstruction = session ? `\n\n${buildStageInstruction(session)}` : "";

  if (action === "first_question") {
    return (
      "Start the mock interview by asking exactly one focused opening question for the candidate's target role and level. Do not score the candidate yet." +
      stageInstruction
    );
  }

  if (action === "next_question") {
    return (
      "Continue the mock interview like a real interviewer. Ask exactly one new follow-up or next-stage question based on the candidate's target role, level, focus area, and prior answers. Avoid repeating earlier questions." +
      stageInstruction
    );
  }

  if (action === "technical_question") {
    return (
      "Ask exactly one practical technical interview question relevant to the candidate's target role and level. Make it a realistic scenario, not trivia. It should be answerable in chat and test reasoning about constraints, implementation approach, debugging signals, edge cases, system behavior, and tradeoffs. Include enough context for the candidate to reason, but do not provide the answer." +
      stageInstruction
    );
  }

  if (action === "tailored_question") {
    const company = session?.companyName ? ` at ${session.companyName}` : "";
    const sessionLabel =
      SESSION_TYPE_LABELS[session?.sessionType ?? "quick_practice"] ?? "interview";
    return (
      `Based on the candidate's CV and the job description provided, generate exactly one ` +
      `highly relevant interview question for the ${sessionLabel} session${company}. ` +
      `The question should directly reference the candidate's experience or the specific ` +
      `requirements in the job description.` +
      stageInstruction
    );
  }

  if (action === "rubric_score") {
    const rubric = session ? getSessionRubric(session) : null;
    return `Score the candidate's most recent answer using the ${rubric?.label ?? "selected"} rubric.
${rubric?.instruction ?? ""}

Output in this exact format:

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
    const rubric = session ? getSessionRubric(session) : null;
    const cvGuidance = session?.cvText
      ? "Include CV improvement advice: missing impact, weak bullets to rewrite, projects to expand, tools/skills to foreground, gaps or unclear experience, and 3 suggested CV bullets based on the interview evidence."
      : "If no CV was provided, include a short section explaining what evidence the candidate should add to their CV from their answers.";
    const jdGuidance = session?.jobDescription
      ? "Include job-fit advice: match against role requirements, missing JD keywords or skills, and preparation priorities for this job."
      : "If no job description was provided, keep job-fit advice role-focused rather than company-specific.";
    const companyGuidance = session?.companyName
      ? `Include company-fit advice for ${session.companyName}: motivation, product or mission understanding, and role alignment.`
      : "If no company was provided, include general company-motivation preparation advice.";

    return `Generate a comprehensive final coaching report for this session using the ${rubric?.label ?? "selected"} rubric.
${rubric?.instruction ?? ""}

Use the transcript evidence only. Be candid, practical, and specific. Include direct next actions, not vague encouragement.
${cvGuidance}
${jdGuidance}
${companyGuidance}

Use this format:

FINAL SESSION REPORT
====================

Overall Performance Score: /10

Rubric Used: ${rubric?.label ?? "Selected rubric"}

Stage-by-stage Performance:
[brief bullets for each interview stage that has evidence]

Best Answer:
[quote or cite the candidate's strongest answer evidence and why it worked]

Weakest Answer:
[quote or cite the weakest answer evidence and the key issue]

Repeated Issues:
[list any patterns that came up across multiple answers]

STAR Improvements Suggested:
[list specific STAR format improvements for key answers]

Technical Depth Rating: /10
[brief commentary]

Confidence & Clarity Rating: /10
[brief commentary]

CV Improvements:
[specific CV changes, missing metrics, projects to expand, and suggested bullets]

Job Fit and Company Prep:
[specific role, JD, CV, and company alignment feedback with transcript evidence]

Next Practice Plan:
[3-5 specific, actionable steps the candidate should take before their next interview]`;
  }

  return message;
}

function withInterviewProgress(
  session: Session,
  interviewProgress: InterviewProgress
): Session {
  return {
    ...session,
    interviewProgress
  };
}

export function answerNeedsCoachingRetry(input: {
  answer: string;
  session: Session;
}) {
  const normalized = input.answer.trim().toLowerCase();
  const words = normalized.split(/\s+/).filter(Boolean);
  const vaguePhrases = [
    "it went well",
    "worked hard",
    "helped out",
    "various things",
    "stuff",
    "things",
    "good team player"
  ];
  const hasVaguePhrase = vaguePhrases.some((phrase) => normalized.includes(phrase));
  const hasSpecificSignal =
    /\d/.test(normalized) ||
    /\b(percent|latency|revenue|users|customers|seconds|minutes|hours|days|engineers|stakeholders|services|requests|errors|reduced|increased|improved|launched|owned|led|designed|built|debugged|migrated)\b/.test(
      normalized
    );
  const technicalSession =
    input.session.interviewMode === "technical" ||
    input.session.sessionType === "technical_screen";
  const hasTechnicalDepth =
    /\b(constraint|tradeoff|edge case|failure|debug|test|monitor|rollback|scal|latency|cache|database|api|architecture|implementation)\b/.test(
      normalized
    );
  const strictMode =
    input.session.interviewerPersona === "strict" ||
    input.session.difficulty === "challenging" ||
    input.session.difficulty === "senior";
  const minimumWords = strictMode ? 35 : 24;

  if (words.length < minimumWords || hasVaguePhrase) {
    return true;
  }

  if (!hasSpecificSignal) {
    return true;
  }

  return technicalSession && strictMode && !hasTechnicalDepth;
}

function buildCandidateAnswerInstruction(input: {
  session: Session;
  answer: string;
  nextProgress: InterviewProgress;
  shouldRetry: boolean;
}) {
  if (input.shouldRetry) {
    return (
      `The candidate's answer is too vague or thin to assess confidently. Pause ` +
      `the interview instead of moving to the next planned question. Give feedback ` +
      `in this compact format:\n` +
      `1. Verdict: say plainly why the answer is not yet interview-ready.\n` +
      `2. Missing evidence: name the most important missing specifics, metrics, ` +
      `ownership, constraints, or tradeoffs.\n` +
      `3. Retry prompt: ask the candidate to answer the same question again with ` +
      `a concrete example, their specific actions, and measurable or observable ` +
      `impact.\n\n` +
      `Do not ask a new interview question yet.\n\n` +
      `Candidate answer: ${input.answer}`
    );
  }

  if (input.session.interviewProgress.completed) {
    return (
      `The candidate answered after the structured interview was already complete. ` +
      `Briefly acknowledge the answer, give one useful coaching note, and invite them ` +
      `to generate the final report. Do not ask another interview question.\n\n` +
      `Candidate answer: ${input.answer}`
    );
  }

  if (input.nextProgress.completed) {
    return (
      `The candidate just answered the final planned interview question. Give feedback ` +
      `in this compact format:\n` +
      `1. Verdict: one sentence on how the answer landed.\n` +
      `2. Strongest signal: the best evidence they gave.\n` +
      `3. Upgrade: the highest-impact fix, ideally with example wording.\n` +
      `4. Close: say the structured interview is complete and invite them to generate ` +
      `the final coaching report.\n\n` +
      `Do not ask another interview question.\n\n` +
      `Candidate answer: ${input.answer}`
    );
  }

  const nextQuestionSession = withInterviewProgress(
    input.session,
    input.nextProgress
  );

  return (
    `The candidate just answered the current interview question. Give feedback in ` +
    `this compact format:\n` +
    `1. Verdict: one sentence on how the answer landed.\n` +
    `2. Strongest signal: the best evidence they gave.\n` +
    `3. Upgrade: the highest-impact fix, ideally with example wording.\n` +
    `4. Next question: exactly one realistic next interview question.\n\n` +
    `${buildStageInstruction(nextQuestionSession)}\n\n` +
    `Candidate answer: ${input.answer}`
  );
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
  session: Session;
  summary: SessionSummary | null;
  userMemory: UserCoachingMemory | null;
  recentMessages: Message[];
  reply: string;
}) {
  const updatedRecentMessages = [
    ...input.recentMessages,
    {
      id: Number.MAX_SAFE_INTEGER,
      sessionId: input.session.id,
      role: "assistant" as const,
      content: input.reply,
      createdAt: new Date().toISOString()
    }
  ];

  const userTurnCount =
    input.action === "message"
      ? await countUserMessages(input.env.DB, input.session.id)
      : 0;

  if (!shouldUpdateSummary(userTurnCount) && input.action !== "generate_report") {
    return;
  }

  try {
    const updatedSummary = await generateUpdatedSummary({
      ai: input.env.AI,
      current: input.summary,
      messages: updatedRecentMessages
    });

    await upsertSummary(input.env.DB, {
      sessionId: input.session.id,
      ...updatedSummary
    });

    if (input.session.useCrossSessionMemory) {
      const updatedUserMemory = await generateUpdatedUserMemory({
        ai: input.env.AI,
        current: input.userMemory,
        messages: updatedRecentMessages
      });
      await upsertUserCoachingMemory(input.env.DB, {
        userId: input.session.clientId,
        ...updatedUserMemory
      });
    }
  } catch (summaryError) {
    console.warn("Summary update skipped", summaryError);
  }
}

async function maybeAdvanceProgress(input: {
  env: Env;
  session: Session;
  action: ChatAction;
  nextProgress?: InterviewProgress;
}) {
  if (!shouldAdvanceProgress(input.action) || !input.nextProgress) {
    return input.session.interviewProgress;
  }

  await updateInterviewProgress(input.env.DB, input.session.id, input.nextProgress);
  return input.nextProgress;
}

function getReportTitle(session: Session) {
  const date = new Date().toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric"
  });
  return `${session.role} final report - ${date}`;
}

async function maybeSaveReport(input: {
  env: Env;
  session: Session;
  action: ChatAction;
  reply: string;
}) {
  if (input.action !== "generate_report") {
    return null;
  }

  const reportId = await createSessionReport(input.env.DB, {
    sessionId: input.session.id,
    clientId: input.session.clientId,
    title: getReportTitle(input.session),
    content: input.reply,
    rubricPreset: input.session.rubricPreset
  });

  return reportId;
}

function streamCoachReply(input: {
  request: Request;
  env: Env;
  sessionId: string;
  session: Session;
  summary: SessionSummary | null;
  userMemory: UserCoachingMemory | null;
  recentMessages: Message[];
  action: ChatAction;
  instruction?: string;
  nextProgress?: InterviewProgress;
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
            userMemory: input.userMemory,
            messages: input.recentMessages,
            instruction: input.instruction,
            maxTokens: input.action === "generate_report" ? 1100 : undefined
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
          const reportId = await maybeSaveReport({
            env: input.env,
            session: input.session,
            action: input.action,
            reply: trimmedReply
          });
          const interviewProgress = await maybeAdvanceProgress({
            env: input.env,
            session: input.session,
            action: input.action,
            nextProgress: input.nextProgress
          });
          await maybeUpdateSummary({
            env: input.env,
            action: input.action,
            session: input.session,
            summary: input.summary,
            userMemory: input.userMemory,
            recentMessages: input.recentMessages,
            reply: trimmedReply
          });

          writeSse(controller, "done", {
            reply: trimmedReply,
            reportId,
            interviewProgress
          });
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

      if (url.pathname === "/api/resume/extract" && request.method === "POST") {
        const formData = await request.formData();
        const user = await getRequestUser(request, env, formData.get("clientId"));
        await upsertUser(env.DB, user);
        const file = formData.get("file");

        if (!(file instanceof File)) {
          throw new HttpError(400, "Resume file is required.");
        }

        return json(await extractResumeFile(file), {}, request);
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
        const rubricPreset = normalizeRubricPreset(
          body.rubricPreset,
          sessionType,
          interviewMode,
          role,
          focus
        );
        const interviewPlan = normalizeInterviewPlan(
          body.interviewPlan,
          sessionType
        );
        const useCrossSessionMemory = getBoolean(body.useCrossSessionMemory);
        const interviewerPersona = getInterviewerPersona(body.interviewerPersona);
        const difficulty = getInterviewDifficulty(body.difficulty);

        const sessionId = await createSession(env.DB, {
          clientId: user.id,
          role,
          level,
          focus,
          cvText,
          jobDescription,
          companyName,
          sessionType,
          interviewMode,
          rubricPreset,
          interviewPlan,
          useCrossSessionMemory,
          interviewerPersona,
          difficulty
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
        const rubricPreset = normalizeRubricPreset(
          body.rubricPreset,
          sessionType,
          interviewMode,
          role,
          focus
        );
        const interviewPlan = normalizeInterviewPlan(
          body.interviewPlan,
          sessionType
        );
        const useCrossSessionMemory = getBoolean(body.useCrossSessionMemory);
        const interviewerPersona = getInterviewerPersona(body.interviewerPersona);
        const difficulty = getInterviewDifficulty(body.difficulty);

        await updateSession(env.DB, sessionId, {
          role,
          level,
          focus,
          cvText,
          jobDescription,
          companyName,
          sessionType,
          interviewMode,
          rubricPreset,
          interviewPlan,
          useCrossSessionMemory,
          interviewerPersona,
          difficulty
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

      const reportsMatch = url.pathname.match(
        /^\/api\/sessions\/([^/]+)\/reports$/
      );

      if (url.pathname === "/api/reports" && request.method === "GET") {
        const user = await getRequestUser(
          request,
          env,
          url.searchParams.get("clientId")
        );
        await upsertUser(env.DB, user);
        return json({ reports: await listClientReports(env.DB, user.id) }, {}, request);
      }

      if (reportsMatch && request.method === "GET") {
        const sessionId = decodeURIComponent(reportsMatch[1]);
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
          { reports: await listSessionReports(env.DB, sessionId) },
          {},
          request
        );
      }

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

        const [summary, recentMessages, userMemory] = await Promise.all([
          getSummary(env.DB, sessionId),
          listRecentMessages(env.DB, sessionId),
          session.useCrossSessionMemory
            ? getUserCoachingMemory(env.DB, user.id)
            : Promise.resolve(null)
        ]);

        const hasCandidateAnswer = recentMessages.some(
          (recentMessage) => recentMessage.role === "user"
        );
        const hasAssistantQuestion = recentMessages.some(
          (recentMessage) => recentMessage.role === "assistant"
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

        const candidateAnswerProgress =
          action === "message" && hasAssistantQuestion
            ? session.interviewProgress.completed
              ? session.interviewProgress
              : advanceInterviewProgress(
                  session.interviewProgress,
                  session.interviewPlan ??
                    normalizeInterviewPlan(null, session.sessionType)
                )
            : undefined;
        const shouldRetryAnswer =
          action === "message" && hasAssistantQuestion
            ? answerNeedsCoachingRetry({ answer: message, session })
            : false;
        const nextProgress =
          candidateAnswerProgress &&
          !session.interviewProgress.completed &&
          !shouldRetryAnswer
            ? candidateAnswerProgress
            : undefined;
        const instruction =
          action === "message" && hasAssistantQuestion && candidateAnswerProgress
            ? buildCandidateAnswerInstruction({
                session,
                answer: message,
                nextProgress: candidateAnswerProgress,
                shouldRetry: shouldRetryAnswer
              })
            : action === "message"
              ? `${buildActionInstruction("first_question", message, session)}

Candidate wrote before the interview started: ${message}`
              : buildActionInstruction(action, message, session);

        if (streamRequested) {
          return streamCoachReply({
            request,
            env,
            sessionId,
            session,
            summary,
            userMemory,
            recentMessages,
            action,
            instruction,
            nextProgress
          });
        }

        const reply = await generateCoachReply({
          ai: env.AI,
          session,
          summary,
          userMemory,
          messages: recentMessages,
          instruction,
          maxTokens: action === "generate_report" ? 1100 : undefined
        });

        await addMessage(env.DB, sessionId, "assistant", reply);
        const reportId = await maybeSaveReport({
          env,
          session,
          action,
          reply
        });
        const interviewProgress = await maybeAdvanceProgress({
          env,
          session,
          action,
          nextProgress
        });
        await maybeUpdateSummary({
          env,
          action,
          session,
          summary,
          userMemory,
          recentMessages,
          reply
        });

        return json({ reply, reportId, interviewProgress }, {}, request);
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
