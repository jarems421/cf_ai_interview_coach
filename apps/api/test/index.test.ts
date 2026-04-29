import { describe, expect, it } from "vitest";
import { getAuthLinks } from "../src/auth";
import worker, {
  assertChatRateLimit,
  buildActionInstruction,
  resetChatRateLimitsForTest
} from "../src/index";
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

function createChatEnv(
  storedMessages: Array<{
    id: number;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }> = [
    {
      id: 1,
      sessionId: "session-1",
      role: "user",
      content: "I led a migration project.",
      createdAt: new Date(0).toISOString()
    }
  ]
) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const aiCalls: unknown[] = [];
  const session = {
    id: "session-1",
    clientId: "browser-1",
    role: "Frontend Engineer",
    level: "Senior",
    focus: "Behavioral",
    cvText: "",
    jobDescription: "",
    companyName: "",
    sessionType: "quick_practice" as const,
    interviewMode: "behavioural" as const,
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
              results: storedMessages as T[],
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
    const sessionInsert = calls.find((call) =>
      call.sql.includes("INSERT INTO sessions")
    );

    expect(sessionInsert?.params).toEqual([
      expect.any(String),
      "browser-1",
      "browser-1",
      "Frontend Engineer",
      "Senior",
      "behavioral",
      "",
      "",
      "",
      "quick_practice",
      "behavioural"
    ]);
  });

  it("requires the browser client id before returning messages", async () => {
    const { env } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions/session-1/messages"),
      env
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: "clientId is required."
    });
  });

  it("does not return messages for another browser client", async () => {
    const { env } = createChatEnv();
    const response = await worker.fetch(
      new Request(
        "https://example.com/api/sessions/session-1/messages?clientId=browser-2"
      ),
      env
    );

    expect(response.status).toBe(404);
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

  it("runs quick actions without storing them as user turns", async () => {
    const { env, calls, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "first_question"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
    expect(calls.some((call) => call.params.includes("user"))).toBe(false);
    expect(calls.some((call) => call.params.includes("assistant"))).toBe(true);
  });

  it("supports technical question commands", async () => {
    const { env, calls, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "technical_question"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
    expect(calls.some((call) => call.params.includes("user"))).toBe(false);
    expect(calls.some((call) => call.params.includes("assistant"))).toBe(true);
  });

  it("does not score a session before the candidate answers", async () => {
    const { env, aiCalls } = createChatEnv([]);
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "scorecard"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reply: expect.stringContaining("at least one candidate answer")
    });
    expect(aiCalls).toHaveLength(0);
  });

  it("supports tailored question command", async () => {
    const { env, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "tailored_question"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
  });

  it("supports rubric score command", async () => {
    const { env, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "rubric_score"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
  });

  it("supports generate report command", async () => {
    const { env, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "generate_report"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(aiCalls).toHaveLength(1);
  });

  it("does not generate report before the candidate answers", async () => {
    const { env, aiCalls } = createChatEnv([]);
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          action: "generate_report"
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      reply: expect.stringContaining("at least one candidate answer")
    });
    expect(aiCalls).toHaveLength(0);
  });

  it("deletes a session", async () => {
    const { env, calls } = createChatEnv();
    const response = await worker.fetch(
      new Request(
        "https://example.com/api/sessions/session-1?clientId=browser-1",
        { method: "DELETE" }
      ),
      env
    );

    expect(response.status).toBe(204);
    expect(calls.some((call) => call.sql.includes("DELETE FROM sessions"))).toBe(true);
  });

  it("creates session with cv and job description", async () => {
    const { env, calls } = createEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          role: "Software Engineer",
          level: "Senior",
          focus: "technical",
          cvText: "5 years experience in Go and distributed systems.",
          jobDescription: "Build large-scale infrastructure at Cloudflare.",
          companyName: "Cloudflare",
          sessionType: "full_mock",
          interviewMode: "technical"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
    const sessionInsert = calls.find((call) =>
      call.sql.includes("INSERT INTO sessions")
    );

    expect(sessionInsert?.params).toEqual([
      expect.any(String),
      "browser-1",
      "browser-1",
      "Software Engineer",
      "Senior",
      "technical",
      "5 years experience in Go and distributed systems.",
      "Build large-scale infrastructure at Cloudflare.",
      "Cloudflare",
      "full_mock",
      "technical"
    ]);
  });

  it("uses in-app auth links instead of Access redirects", () => {
    const { env } = createEnv();

    expect(getAuthLinks(env)).toEqual({
      loginUrl: "/",
      logoutUrl: "/"
    });
  });

  it("builds technical questions around scenarios and tradeoffs", () => {
    expect(buildActionInstruction("technical_question", "")).toContain(
      "realistic scenario"
    );
    expect(buildActionInstruction("technical_question", "")).toContain(
      "edge cases"
    );
    expect(buildActionInstruction("technical_question", "")).toContain(
      "tradeoffs"
    );
  });

  it("rate limits repeated chat requests by profile", () => {
    resetChatRateLimitsForTest();

    for (let count = 0; count < 30; count += 1) {
      expect(() => assertChatRateLimit("browser-1", 1_000)).not.toThrow();
    }

    expect(() => assertChatRateLimit("browser-1", 1_000)).toThrow(
      "Too many coaching requests"
    );
    expect(() => assertChatRateLimit("browser-2", 1_000)).not.toThrow();
    expect(() => assertChatRateLimit("browser-1", 62_000)).not.toThrow();

    resetChatRateLimitsForTest();
  });
});
