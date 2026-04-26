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

function createChatEnv() {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const aiCalls: unknown[] = [];
  const session = {
    id: "session-1",
    clientId: "browser-1",
    role: "Frontend Engineer",
    level: "Senior",
    focus: "Behavioral",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  };

  const env = {
    AI: {
      async run(_model: string, input: unknown) {
        aiCalls.push(input);
        return { response: "Good start. Add a metric, then I will ask a follow-up." };
      }
    },
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
            if (sql.includes("FROM sessions")) {
              return session as T;
            }

            if (sql.includes("FROM session_summaries")) {
              return {
                sessionId: "session-1",
                summary: "The candidate is practicing concise examples.",
                strengths: "Clear structure",
                improvementAreas: "Add measurable impact",
                updatedAt: new Date(0).toISOString()
              } as T;
            }

            return null;
          },
          async all<T>() {
            return {
              results: [
                {
                  id: 1,
                  sessionId: "session-1",
                  role: "user",
                  content: "I led a migration project.",
                  createdAt: new Date(0).toISOString()
                }
              ] as T[],
              success: true,
              meta: {}
            };
          }
        };

        return statement;
      }
    }
  } as unknown as Env;

  return { env, calls, aiCalls };
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

  it("stores chat turns and returns the workers ai reply", async () => {
    const { env, calls, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message: "I led a migration project."
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reply: "Good start. Add a metric, then I will ask a follow-up."
    });
    expect(aiCalls).toHaveLength(1);
    expect(calls.some((call) => call.params.includes("user"))).toBe(true);
    expect(calls.some((call) => call.params.includes("assistant"))).toBe(true);
  });
});
