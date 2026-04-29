import { describe, expect, it } from "vitest";
import { strToU8, zipSync } from "fflate";
import { getAuthLinks } from "../src/auth";
import {
  advanceInterviewProgress,
  buildStageInstruction,
  getDefaultInterviewPlan,
  getInitialInterviewProgress,
  normalizeInterviewPlan
} from "../src/interviewPlan";
import worker, {
  assertChatRateLimit,
  buildActionInstruction as buildChatActionInstruction,
  resetChatRateLimitsForTest
} from "../src/index";
import { extractResumeFile } from "../src/resume";
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
    interviewPlan: getDefaultInterviewPlan("quick_practice"),
    interviewProgress: getInitialInterviewProgress(),
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
      "behavioural",
      expect.stringContaining("Warm-up"),
      JSON.stringify({ stageIndex: 0, questionInStage: 0, completed: false })
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

  it("streams chat replies when requested", async () => {
    const { env, calls, aiCalls } = createChatEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message: "I led a migration project.",
          stream: true
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    await expect(response.text()).resolves.toContain("event: done");
    expect(aiCalls).toHaveLength(1);
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
    expect(
      calls.some(
        (call) =>
          call.sql.includes("UPDATE sessions") &&
          call.sql.includes("interview_progress")
      )
    ).toBe(true);
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
    const { env, calls, aiCalls } = createChatEnv();
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
    expect(
      calls.some(
        (call) =>
          call.sql.includes("UPDATE sessions") &&
          call.sql.includes("interview_progress")
      )
    ).toBe(false);
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
      "technical",
      expect.stringContaining("Role depth"),
      JSON.stringify({ stageIndex: 0, questionInStage: 0, completed: false })
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
    expect(buildChatActionInstruction("technical_question", "")).toContain(
      "realistic scenario"
    );
    expect(buildChatActionInstruction("technical_question", "")).toContain(
      "edge cases"
    );
    expect(buildChatActionInstruction("technical_question", "")).toContain(
      "tradeoffs"
    );
  });

  it("normalizes interview plans and advances progress", () => {
    const plan = normalizeInterviewPlan(
      {
        stages: [
          {
            id: "opener",
            label: "Opener",
            objective: "Start",
            questionCount: 99,
            enabled: true
          },
          {
            id: "disabled",
            label: "Disabled",
            objective: "Skip",
            questionCount: 2,
            enabled: false
          }
        ]
      },
      "full_mock"
    );

    expect(plan.stages).toHaveLength(1);
    expect(plan.stages[0].questionCount).toBe(6);
    expect(
      advanceInterviewProgress(
        { stageIndex: 0, questionInStage: 5, completed: false },
        plan
      )
    ).toEqual({ stageIndex: 0, questionInStage: 6, completed: true });
  });

  it("builds stage-aware prompts with personalization context", () => {
    const instruction = buildStageInstruction({
      id: "session-1",
      clientId: "browser-1",
      role: "Security Engineer",
      level: "Mid-level",
      focus: "incident response",
      cvText: "Built a SIEM enrichment project with Python.",
      jobDescription: "Investigate security alerts and improve SOC workflows.",
      companyName: "Cloudflare",
      sessionType: "technical_screen",
      interviewMode: "technical",
      interviewPlan: getDefaultInterviewPlan("technical_screen"),
      interviewProgress: getInitialInterviewProgress(),
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    });

    expect(instruction).toContain("Current interview stage");
    expect(instruction).toContain("Stage objective");
    expect(instruction).toContain("candidate's CV");
    expect(instruction).toContain("job description");
    expect(instruction).toContain("Cloudflare");
  });

  it("extracts readable TXT resumes", async () => {
    const file = new File(
      [
        "Built APIs in TypeScript, improved latency by 35%, and led accessibility reviews across a React platform."
      ],
      "resume.txt",
      { type: "text/plain" }
    );

    await expect(extractResumeFile(file)).resolves.toMatchObject({
      fileName: "resume.txt",
      fileType: "txt",
      text: expect.stringContaining("Built APIs in TypeScript"),
      quality: "warning"
    });
  });

  it("extracts readable DOCX resumes", async () => {
    const docx = zipSync({
      "word/document.xml": strToU8(
        '<w:document><w:body><w:p><w:r><w:t>Designed cloud security controls, automated incident triage, and mentored analysts.</w:t></w:r></w:p></w:body></w:document>'
      )
    });
    const docxBuffer = docx.buffer.slice(
      docx.byteOffset,
      docx.byteOffset + docx.byteLength
    ) as ArrayBuffer;
    const file = new File([docxBuffer], "resume.docx", {
      type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
    });

    await expect(extractResumeFile(file)).resolves.toMatchObject({
      fileName: "resume.docx",
      fileType: "docx",
      text: expect.stringContaining("cloud security controls")
    });
  });

  it("rejects unsupported, oversized, and unreadable resume uploads", async () => {
    await expect(
      extractResumeFile(new File(["hello"], "resume.rtf"))
    ).rejects.toThrow("Upload a PDF, DOCX, TXT, or Markdown resume.");

    await expect(
      extractResumeFile(new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "big.txt"))
    ).rejects.toThrow("Resume file must be 5 MB or smaller.");

    await expect(
      extractResumeFile(new File(["\u0001".repeat(100)], "broken.txt"))
    ).rejects.toThrow("unreadable text");
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
