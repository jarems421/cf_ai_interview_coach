import { describe, expect, it } from "vitest";
import worker from "../src/index";

describe("worker", () => {
  it("returns health status", async () => {
    const response = await worker.fetch(new Request("https://example.com/api/health"));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cf_ai_interview_coach"
    });
  });
});

