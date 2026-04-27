import type { InterviewMode, Message, RubricResult, Session, SessionSummary, SessionType } from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// ── Prompts ──────────────────────────────────────────────────────────────────

const COACH_SYSTEM_PROMPT = `You are an AI interview coach for a job candidate.

Your job is to run a realistic mock interview and help the candidate improve quickly.

Rules:
- Ask one interview question at a time.
- If the candidate has not answered a question yet, ask a targeted opening question.
- After an answer, give feedback in this compact format:
  1. Verdict: one sentence on how the answer landed.
  2. Strongest signal: the best evidence they gave.
  3. Upgrade: the highest-impact fix, ideally with example wording.
  4. Next question: one realistic follow-up question.
- Adapt to the target role, level, focus area, CV, and job description if provided.
- Calibrate difficulty to the level. Senior and staff candidates should get ambiguity, tradeoffs, leadership, and impact questions.
- Be encouraging without being vague.
- Prefer concrete revisions, metrics, tradeoffs, and example phrasing.
- Keep responses under 150 words unless the user asks for a deeper review.
- Do not over-explain the framework unless asked.
- Never claim you are a human interviewer.`;

const CV_MAX_CHARS = 1800;
const JD_MAX_CHARS = 1200;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n[truncated]" : text;
}

const SESSION_TYPE_CONTEXT: Record<SessionType, string> = {
  quick_practice: "Session mode: Quick Practice — one question at a time with instant feedback.",
  full_mock: "Session mode: Full Mock Interview — simulate a complete 5-8 question interview, then produce a final report.",
  project_defence: "Session mode: Project Defence — the candidate has chosen a specific project; ask deep, probing questions about it (design decisions, trade-offs, failures, improvements).",
  technical_screen: "Session mode: Technical Screen — ask practical coding, data structures, system design, or security questions appropriate to the role.",
  company_specific: "Session mode: Company-specific — tailor all questions to the company culture, tech stack, and role expectations."
};

const INTERVIEW_MODE_INSTRUCTIONS: Record<InterviewMode, string> = {
  behavioural: "Focus on STAR-format behavioural questions (Situation, Task, Action, Result). Probe for real examples.",
  technical: "Focus on technical depth, implementation details, system design, and trade-offs relevant to the role.",
  project_deep_dive: "Pick one significant project from the candidate's background and systematically probe it: motivation, design, implementation, results, and what they would change.",
  company_motivation: "Ask why the candidate wants this specific company and role. Probe for genuine knowledge of the company's mission, products, and challenges.",
  weakness_gap: "Probe for honest self-assessment: weaknesses, gaps in experience, failures, and growth areas. Look for self-awareness and a growth mindset.",
  final_simulation: "Simulate a full final-round interview: mix behavioural, technical, and culture-fit questions. Maintain a realistic interviewer tone throughout."
};

export function buildSessionContext(input: {
  role: string;
  level: string;
  focus: string;
  cvText?: string;
  jobDescription?: string;
  companyName?: string;
  sessionType?: SessionType;
  interviewMode?: InterviewMode;
  summary?: string;
  strengths?: string;
  improvementAreas?: string;
}) {
  const memory = [
    input.summary && `Session summary: ${input.summary}`,
    input.strengths && `Observed strengths: ${input.strengths}`,
    input.improvementAreas && `Improvement areas: ${input.improvementAreas}`
  ]
    .filter(Boolean)
    .join("\n");

  const cvSection =
    input.cvText?.trim()
      ? `\nCandidate CV/Resume:\n${truncate(input.cvText.trim(), CV_MAX_CHARS)}`
      : "";

  const jdSection =
    input.jobDescription?.trim()
      ? `\nJob Description:\n${truncate(input.jobDescription.trim(), JD_MAX_CHARS)}`
      : "";

  const tailoringLines = [
    input.companyName && `Target company: ${input.companyName}`,
    input.sessionType && SESSION_TYPE_CONTEXT[input.sessionType],
    input.interviewMode && `Interview mode: ${INTERVIEW_MODE_INSTRUCTIONS[input.interviewMode]}`
  ]
    .filter(Boolean)
    .join("\n");

  const tailoringSection = tailoringLines ? `Tailoring context:\n${tailoringLines}\n\n` : "";

  return `Candidate target:
- Role: ${input.role}
- Level: ${input.level}
- Company: ${input.companyName?.trim() || "not specified"}
- Interview mode: ${input.interviewMode ?? input.focus}
- Focus: ${input.focus}
${cvSection}${jdSection}

${tailoringSection}Memory:
${memory || "No prior coaching memory yet."}`;
}

export function buildRubricPrompt(answer: string, question: string) {
  return `You are evaluating a candidate's interview answer. Return valid JSON only.

Score the answer on five criteria (each 1–10):
- relevance: How well the answer addresses the question asked
- specificity: How concrete and specific the details are
- technicalDepth: How well it demonstrates technical or domain knowledge (use 5 if not applicable)
- communicationClarity: How clear, structured, and articulate the delivery is
- evidenceExamples: How well it uses real examples, metrics, or evidence

Also provide:
- overall: weighted average rounded to one decimal
- strengths: one concise sentence on what was strongest
- weaknesses: one concise sentence on the most impactful gap
- improvedAnswer: a rewritten version using STAR format, adding metrics/specificity, under 120 words
- followUpQuestion: one realistic follow-up question an interviewer would ask next

Return this exact JSON shape and nothing else:
{
  "scores": {
    "relevance": 0,
    "specificity": 0,
    "technicalDepth": 0,
    "communicationClarity": 0,
    "evidenceExamples": 0,
    "overall": 0.0
  },
  "strengths": "",
  "weaknesses": "",
  "improvedAnswer": "",
  "followUpQuestion": ""
}

Interview question: ${question}

Candidate answer: ${answer}`;
}

export function buildSummaryPrompt(transcript: string) {
  return `Update the coaching memory for this mock interview.

Return only valid JSON with these string fields:
- summary
- strengths
- improvementAreas

Keep each field under 180 characters.

Transcript:
${transcript}`;
}

// ── AI helpers ────────────────────────────────────────────────────────────────

type AiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

type AiResult = {
  response?: string;
  result?: {
    response?: string;
    choices?: Array<{ message?: { content?: string }; text?: string }>;
  };
  choices?: Array<{ message?: { content?: string }; text?: string }>;
};

export function extractAiText(result: unknown) {
  if (typeof result === "string") {
    return result.trim();
  }

  const output = result as AiResult;
  const text =
    output.response ??
    output.result?.response ??
    output.choices?.[0]?.message?.content ??
    output.choices?.[0]?.text ??
    output.result?.choices?.[0]?.message?.content ??
    output.result?.choices?.[0]?.text;

  return typeof text === "string" ? text.trim() : "";
}

export async function generateCoachReply(input: {
  ai: Ai;
  session: Session;
  summary?: SessionSummary | null;
  messages: Message[];
  instruction?: string;
}) {
  const messages: AiMessage[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    {
      role: "system",
      content: buildSessionContext({
        role: input.session.role,
        level: input.session.level,
        focus: input.session.focus,
        cvText: input.session.cvText,
        jobDescription: input.session.jobDescription,
        companyName: input.session.companyName,
        sessionType: input.session.sessionType,
        interviewMode: input.session.interviewMode,
        summary: input.summary?.summary,
        strengths: input.summary?.strengths,
        improvementAreas: input.summary?.improvementAreas
      })
    },
    ...input.messages
      .filter((message) => message.role === "user" || message.role === "assistant")
      .map((message) => ({
        role: message.role,
        content: message.content
      })),
    ...(input.instruction
      ? [{ role: "user" as const, content: input.instruction }]
      : [])
  ];

  const result = await input.ai.run(MODEL, {
    messages,
    max_tokens: 430,
    temperature: 0.38
  });

  const reply = extractAiText(result);

  if (!reply) {
    throw new Error("Workers AI returned an empty response.");
  }

  return reply;
}

export async function generateRubric(input: {
  ai: Ai;
  answer: string;
  question: string;
}): Promise<RubricResult> {
  const result = await input.ai.run(MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You are an expert interview evaluator. Output valid JSON only. Do not include any text outside the JSON object."
      },
      {
        role: "user",
        content: buildRubricPrompt(input.answer, input.question)
      }
    ],
    max_tokens: 520,
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const text = extractAiText(result);
  const parsed = JSON.parse(text) as Partial<{
    scores: Partial<{
      relevance: unknown;
      specificity: unknown;
      technicalDepth: unknown;
      communicationClarity: unknown;
      evidenceExamples: unknown;
      overall: unknown;
    }>;
    strengths: unknown;
    weaknesses: unknown;
    improvedAnswer: unknown;
    followUpQuestion: unknown;
  }>;

  function clampScore(v: unknown, fallback: number): number {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(10, Math.max(0, Math.round(n * 10) / 10)) : fallback;
  }

  const relevance = clampScore(parsed.scores?.relevance, 5);
  const specificity = clampScore(parsed.scores?.specificity, 5);
  const technicalDepth = clampScore(parsed.scores?.technicalDepth, 5);
  const communicationClarity = clampScore(parsed.scores?.communicationClarity, 5);
  const evidenceExamples = clampScore(parsed.scores?.evidenceExamples, 5);

  const computedOverall =
    Math.round(
      ((relevance + specificity + technicalDepth + communicationClarity + evidenceExamples) / 5) * 10
    ) / 10;

  const overall = clampScore(parsed.scores?.overall, computedOverall);

  return {
    scores: {
      relevance,
      specificity,
      technicalDepth,
      communicationClarity,
      evidenceExamples,
      overall
    },
    strengths: typeof parsed.strengths === "string" ? parsed.strengths : "",
    weaknesses: typeof parsed.weaknesses === "string" ? parsed.weaknesses : "",
    improvedAnswer: typeof parsed.improvedAnswer === "string" ? parsed.improvedAnswer : "",
    followUpQuestion:
      typeof parsed.followUpQuestion === "string" ? parsed.followUpQuestion : ""
  };
}

export async function generateUpdatedSummary(input: {
  ai: Ai;
  current?: SessionSummary | null;
  messages: Message[];
}) {
  const transcript = input.messages
    .map((message) => `${message.role.toUpperCase()}: ${message.content}`)
    .join("\n\n");

  const result = await input.ai.run(MODEL, {
    messages: [
      {
        role: "system",
        content:
          "You maintain concise memory for an interview coaching app. Output valid JSON only."
      },
      {
        role: "user",
        content: `${input.current ? `Current memory:\n${JSON.stringify(input.current)}\n\n` : ""}${buildSummaryPrompt(transcript)}`
      }
    ],
    max_tokens: 220,
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const text = extractAiText(result);
  const parsed = JSON.parse(text) as Partial<{
    summary: string;
    strengths: string;
    improvementAreas: string;
  }>;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    strengths: typeof parsed.strengths === "string" ? parsed.strengths : "",
    improvementAreas:
      typeof parsed.improvementAreas === "string" ? parsed.improvementAreas : ""
  };
}

export function shouldUpdateSummary(messages: Message[]) {
  const userTurns = messages.filter((message) => message.role === "user").length;
  return userTurns > 0 && userTurns % 4 === 0;
}
