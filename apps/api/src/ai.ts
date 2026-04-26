import { buildSessionContext, buildSummaryPrompt, COACH_SYSTEM_PROMPT } from "./prompts";
import type { Message, Session, SessionSummary } from "./types";

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
}) {
  const messages: AiMessage[] = [
    { role: "system", content: COACH_SYSTEM_PROMPT },
    {
      role: "system",
      content: buildSessionContext({
        role: input.session.role,
        level: input.session.level,
        focus: input.session.focus,
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
      }))
  ];

  const result = await input.ai.run(MODEL, {
    messages,
    max_tokens: 650,
    temperature: 0.45
  });

  const reply = extractAiText(result);

  if (!reply) {
    throw new Error("Workers AI returned an empty response.");
  }

  return reply;
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
    max_tokens: 350,
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
  return userTurns > 0 && userTurns % 3 === 0;
}

