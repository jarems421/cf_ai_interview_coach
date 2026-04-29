import { describe, expect, it } from "vitest";
import {
  consumeAiEventStream,
  extractAiStreamDelta,
  extractAiText,
  shouldUpdateSummary
} from "../src/ai";

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
});
