import { describe, expect, it } from "vitest";
import { extractAiText, shouldUpdateSummary } from "../src/ai";
import type { Message } from "../src/types";

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
    const messages = [
      { role: "user", content: "a" },
      { role: "assistant", content: "b" },
      { role: "user", content: "c" },
      { role: "assistant", content: "d" },
      { role: "user", content: "e" },
      { role: "assistant", content: "f" },
      { role: "user", content: "g" }
    ].map(
      (message, index) =>
        ({
          id: index,
          sessionId: "session-1",
          createdAt: new Date(0).toISOString(),
          ...message
        }) as Message
    );

    expect(shouldUpdateSummary(messages)).toBe(true);
  });
});
