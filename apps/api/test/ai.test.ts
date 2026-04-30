import { describe, expect, it } from "vitest";
import {
  buildCoachAiInput,
  consumeAiEventStream,
  extractAiStreamDelta,
  extractAiText,
  shouldUpdateSummary
} from "../src/ai";
import { getDefaultInterviewPlan, getInitialInterviewProgress } from "../src/interviewPlan";
import type { Session } from "../src/types";

function createSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "session-1",
    clientId: "user-1",
    role: "Frontend Engineer",
    level: "Senior",
    focus: "technical communication",
    cvText: "",
    jobDescription: "",
    companyName: "",
    sessionType: "quick_practice",
    interviewMode: "behavioural",
    rubricPreset: "behavioral",
    interviewPlan: getDefaultInterviewPlan("quick_practice"),
    interviewProgress: getInitialInterviewProgress(),
    useCrossSessionMemory: false,
    interviewerPersona: "realistic",
    difficulty: "standard",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...overrides
  };
}

describe("ai helpers", () => {
  it("extracts text from common Workers AI response shapes", () => {
    expect(extractAiText({ response: " Good answer. " })).toBe("Good answer.");
    expect(
      extractAiText({
        result: {
          choices: [{ message: { content: "Try adding metrics." } }]
        }
      })
    ).toBe("Try adding metrics.");
  });

  it("updates summaries every four user turns", () => {
    expect(shouldUpdateSummary(4)).toBe(true);
    expect(shouldUpdateSummary(5)).toBe(false);
  });

  it("extracts text deltas from Workers AI stream payloads", () => {
    expect(extractAiStreamDelta({ response: "Hello" })).toBe("Hello");
    expect(
      extractAiStreamDelta({
        choices: [{ delta: { content: " there" } }]
      })
    ).toBe(" there");
  });

  it("consumes server-sent Workers AI stream chunks", async () => {
    const chunks: string[] = [];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(
          encoder.encode('data: {"response":"Hello"}\n\ndata: {"response":" there"}\n\n')
        );
        controller.enqueue(encoder.encode("data: [DONE]\n\n"));
        controller.close();
      }
    });

    await consumeAiEventStream(stream, (text) => chunks.push(text));

    expect(chunks).toEqual(["Hello", " there"]);
  });

  it("includes cross-session memory only when the session opts in", () => {
    const userMemory = {
      userId: "user-1",
      summary: "Candidate repeatedly undersells impact.",
      recurringStrengths: "Clear communication",
      recurringWeaknesses: "Needs metrics",
      recommendations: "Prepare metric-backed STAR stories",
      updatedAt: new Date(0).toISOString()
    };

    const disabled = buildCoachAiInput({
      session: createSession({ useCrossSessionMemory: false }),
      summary: null,
      userMemory,
      messages: []
    });
    expect(JSON.stringify(disabled)).not.toContain("undersells impact");

    const enabled = buildCoachAiInput({
      session: createSession({ useCrossSessionMemory: true }),
      summary: null,
      userMemory,
      messages: []
    });
    expect(JSON.stringify(enabled)).toContain("undersells impact");
    expect(JSON.stringify(enabled)).toContain("Needs metrics");
  });

  it("includes persona and difficulty in the coaching context", () => {
    const input = buildCoachAiInput({
      session: createSession({
        interviewerPersona: "strict",
        difficulty: "senior"
      }),
      messages: []
    });

    expect(JSON.stringify(input)).toContain("strict senior interviewer");
    expect(JSON.stringify(input)).toContain("Difficulty: senior");
  });
});
