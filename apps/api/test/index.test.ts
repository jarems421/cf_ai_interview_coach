import { describe, expect, it } from "vitest";
import worker from "../src/index";
import type { Env } from "../src/types";

function createEnv(results: Record<string, unknown[]> = {}) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];

  const env = {
    AI: {},
    DB: {
      prepare(sql: string) {
        const statement = {
          params: [] as unknown[],
          bind(...params: unknown[]) {
            statement.params = params;
            calls.push({ sql, params });
            return statement;
          },
          async run() {
            return { success: true };
          },
          async first<T>() {
            return (results.first?.[0] ?? null) as T | null;
          },
          async all<T>() {
            return {
              results: (results.all ?? []) as T[],
              success: true,
              meta: {}
            };
          }
        };

        return statement;
      }
    }
  } as unknown as Env;

  return { env, calls };
}

describe("worker", () => {
  it("returns health status", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/health"),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      service: "cf_ai_interview_coach"
    });
  });

  it("validates required session fields", async () => {
    const { env } = createEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions", {
        method: "POST",
        body: JSON.stringify({ role: "Engineer" })
      }),
      env
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "clientId is required."
    });
  });

  it("creates sessions in d1", async () => {
    const { env, calls } = createEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          role: "Frontend Engineer",
          level: "Senior",
          focus: "behavioral"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
    await expect(response.json()).resolves.toMatchObject({
      sessionId: expect.any(String)
    });
    expect(calls[0].params).toEqual([
      expect.any(String),
      "browser-1",
      "Frontend Engineer",
      "Senior",
      "behavioral"
    ]);
  });
});
