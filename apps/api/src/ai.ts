import {
  buildSessionContext,
  buildSummaryPrompt,
  buildUserMemoryPrompt,
  COACH_SYSTEM_PROMPT
} from "./prompts";
import type { Message, Session, SessionSummary, UserCoachingMemory } from "./types";

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
  choices?: Array<{
    delta?: { content?: string };
    message?: { content?: string };
    text?: string;
  }>;
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
  userMemory?: UserCoachingMemory | null;
  messages: Message[];
  instruction?: string;
  maxTokens?: number;
}) {
  const result = await input.ai.run(MODEL, buildCoachAiInput(input));
  const reply = extractAiText(result);

  if (!reply) {
    throw new Error("Workers AI returned an empty response.");
  }

  return reply;
}

export function buildCoachAiInput(input: {
  session: Session;
  summary?: SessionSummary | null;
  userMemory?: UserCoachingMemory | null;
  messages: Message[];
  instruction?: string;
  maxTokens?: number;
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
        interviewerPersona: input.session.interviewerPersona,
        difficulty: input.session.difficulty,
        summary: input.summary?.summary,
        strengths: input.summary?.strengths,
        improvementAreas: input.summary?.improvementAreas,
        userMemory: input.session.useCrossSessionMemory
          ? input.userMemory
          : null
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

  return {
    messages,
    max_tokens: input.maxTokens ?? 430,
    temperature: 0.38
  };
}

export async function generateCoachReplyStream(input: {
  ai: Ai;
  session: Session;
  summary?: SessionSummary | null;
  userMemory?: UserCoachingMemory | null;
  messages: Message[];
  instruction?: string;
  maxTokens?: number;
}) {
  const result = (await input.ai.run(MODEL, {
    ...buildCoachAiInput(input),
    stream: true
  })) as unknown;

  if (result instanceof ReadableStream) {
    return result;
  }

  if (result instanceof Response && result.body) {
    return result.body;
  }

  const reply = extractAiText(result);
  if (!reply) {
    throw new Error("Workers AI returned an empty response.");
  }

  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(
        new TextEncoder().encode(`data: ${JSON.stringify({ response: reply })}\n\n`)
      );
      controller.enqueue(new TextEncoder().encode("data: [DONE]\n\n"));
      controller.close();
    }
  });
}

export function extractAiStreamDelta(payload: unknown) {
  if (typeof payload === "string") {
    return payload;
  }

  const output = payload as AiResult;
  const text =
    output.response ??
    output.result?.response ??
    output.choices?.[0]?.delta?.content ??
    output.choices?.[0]?.message?.content ??
    output.choices?.[0]?.text ??
    output.result?.choices?.[0]?.message?.content ??
    output.result?.choices?.[0]?.text;

  return typeof text === "string" ? text : "";
}

export async function consumeAiEventStream(
  stream: ReadableStream<Uint8Array>,
  onDelta: (text: string) => void
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  function consumeEvent(eventText: string) {
    const data = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice(5).trimStart())
      .join("\n")
      .trim();

    if (!data || data === "[DONE]") {
      return;
    }

    try {
      const delta = extractAiStreamDelta(JSON.parse(data));
      if (delta) {
        onDelta(delta);
      }
    } catch {
      onDelta(data);
    }
  }

  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let boundaryMatch = /\r?\n\r?\n/.exec(buffer);
    while (boundaryMatch) {
      const boundary = boundaryMatch.index;
      const eventText = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + boundaryMatch[0].length);
      consumeEvent(eventText);
      boundaryMatch = /\r?\n\r?\n/.exec(buffer);
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    consumeEvent(buffer);
  }
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

export async function generateUpdatedUserMemory(input: {
  ai: Ai;
  current?: UserCoachingMemory | null;
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
          "You maintain durable cross-session coaching memory for an interview preparation app. Output valid JSON only."
      },
      {
        role: "user",
        content: buildUserMemoryPrompt({
          current: input.current,
          transcript
        })
      }
    ],
    max_tokens: 280,
    temperature: 0.2,
    response_format: { type: "json_object" }
  });

  const text = extractAiText(result);
  const parsed = JSON.parse(text) as Partial<{
    summary: string;
    recurringStrengths: string;
    recurringWeaknesses: string;
    recommendations: string;
  }>;

  return {
    summary: typeof parsed.summary === "string" ? parsed.summary : "",
    recurringStrengths:
      typeof parsed.recurringStrengths === "string"
        ? parsed.recurringStrengths
        : "",
    recurringWeaknesses:
      typeof parsed.recurringWeaknesses === "string"
        ? parsed.recurringWeaknesses
        : "",
    recommendations:
      typeof parsed.recommendations === "string" ? parsed.recommendations : ""
  };
}

export function shouldUpdateSummary(userTurnCount: number) {
  return userTurnCount > 0 && userTurnCount % 4 === 0;
}
