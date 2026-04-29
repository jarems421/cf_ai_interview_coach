import { describe, expect, it } from "vitest";
import {
  getBasicSuggestionOptions,
  getRoleSuggestionOptions
} from "./suggestions";

describe("suggestions", () => {
  it("suggests cybersecurity roles from synonym searches", () => {
    expect(getRoleSuggestionOptions("cybersecurity").map((option) => option.value))
      .toEqual(
        expect.arrayContaining([
          "Security Engineer",
          "Cybersecurity Analyst",
          "SOC Analyst",
          "Application Security Engineer",
          "Cloud Security Engineer"
        ])
      );
  });

  it("allows custom role values when no role fits", () => {
    expect(getRoleSuggestionOptions("Quantum Sandwich Maker")).toContainEqual({
      label: 'Use "Quantum Sandwich Maker"',
      value: "Quantum Sandwich Maker"
    });
  });

  it("keeps basic suggestions filtered locally", () => {
    expect(
      getBasicSuggestionOptions("sys", [
        "System design and tradeoffs",
        "Frontend architecture"
      ])
    ).toEqual([
      {
        label: "System design and tradeoffs",
        value: "System design and tradeoffs"
      }
    ]);
  });
});
