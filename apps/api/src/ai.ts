import { buildRubricPrompt, buildSessionContext, buildSummaryPrompt, COACH_SYSTEM_PROMPT } from "./prompts";
import type { InterviewMode, Message, RubricResult, Session, SessionSummary } from "./types";

const MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

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
