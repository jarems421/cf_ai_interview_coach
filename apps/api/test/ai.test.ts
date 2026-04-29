import { describe, expect, it } from "vitest";
import { extractAiText, shouldUpdateSummary } from "../src/ai";

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
});
