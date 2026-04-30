import { afterEach, describe, expect, it, vi } from "vitest";
import { strToU8, zipSync } from "fflate";
import { authTestExports, getAuthLinks } from "../src/auth";
import {
  advanceInterviewProgress,
  buildStageInstruction,
  getDefaultInterviewPlan,
  getInitialInterviewProgress,
  normalizeInterviewPlan
} from "../src/interviewPlan";
import worker, {
  answerNeedsCoachingRetry,
  assertChatRateLimit,
  buildActionInstruction as buildChatActionInstruction,
  resetChatRateLimitsForTest
} from "../src/index";
import { extractResumeFile } from "../src/resume";
import type { Env } from "../src/types";

afterEach(() => {
  authTestExports.certCache.clear();
  vi.unstubAllGlobals();
});

function createEnv(
  results: Record<string, unknown[]> = {},
  envOverrides: Partial<Env> = {}
) {
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
    },
    ...envOverrides
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
  ],
  sessionOverrides: Record<string, unknown> = {},
  envOverrides: Partial<Env> = {}
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
    rubricPreset: "behavioral" as const,
    interviewPlan: JSON.stringify(getDefaultInterviewPlan("quick_practice")),
    interviewProgress: JSON.stringify(getInitialInterviewProgress()),
    useCrossSessionMemory: 0,
    interviewerPersona: "realistic",
    difficulty: "standard",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    ...sessionOverrides
  };

  const env = {
    AI: {
      async run(_model: string, input: unknown) {
        aiCalls.push(input);
        if (
          typeof input === "object" &&
          input !== null &&
          "response_format" in input
        ) {
          return {
            response: JSON.stringify({
              summary: "Practicing concise examples with stronger evidence.",
              strengths: "Clear structure",
              improvementAreas: "Add measurable impact",
              recurringStrengths: "Clear communication",
              recurringWeaknesses: "Needs metrics",
              recommendations: "Prepare STAR answers with numbers"
            })
          };
        }
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

            if (sql.includes("FROM user_coaching_memory")) {
              return {
                userId: "browser-1",
                summary: "Candidate undersells impact across sessions.",
                recurringStrengths: "Clear communication",
                recurringWeaknesses: "Needs metrics",
                recommendations: "Prepare STAR answers with numbers",
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
    },
    ...envOverrides
  } as unknown as Env;

  return { env, calls, aiCalls, session };
}

function base64Url(input: Uint8Array | string) {
  const bytes =
    typeof input === "string" ? new TextEncoder().encode(input) : input;
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

async function createAccessJwt(input: {
  teamDomain?: string;
  audience?: string;
  expiresInSeconds?: number;
}) {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256"
    },
    true,
    ["sign", "verify"]
  );
  const publicJwk = (await crypto.subtle.exportKey(
    "jwk",
    keyPair.publicKey
  )) as JsonWebKey & { kid?: string };
  publicJwk.kid = "test-key";
  publicJwk.alg = "RS256";
  publicJwk.use = "sig";

  const now = Math.floor(Date.now() / 1000);
  const header = base64Url(
    JSON.stringify({ alg: "RS256", kid: "test-key", typ: "JWT" })
  );
  const payload = base64Url(
    JSON.stringify({
      sub: "user-123",
      email: "access@example.com",
      name: "Access User",
      iss: input.teamDomain ?? "https://team.example.com",
      aud: [input.audience ?? "aud-123"],
      iat: now,
      nbf: now - 10,
      exp: now + (input.expiresInSeconds ?? 300)
    })
  );
  const signature = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    keyPair.privateKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );

  return {
    token: `${header}.${payload}.${base64Url(new Uint8Array(signature))}`,
    publicJwk
  };
}

function mockAccessCerts(publicJwk: JsonWebKey) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        keys: [publicJwk]
      })
    )
  );
}

function escapePdfText(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)");
}

function createPdfBuffer(pageTexts: string[]) {
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Kids [${pageTexts
      .map((_text, index) => `${3 + index * 2} 0 R`)
      .join(" ")}] /Count ${pageTexts.length} >>`
  ];

  pageTexts.forEach((text, index) => {
    const pageObjectId = 3 + index * 2;
    const contentObjectId = pageObjectId + 1;
    const content = `BT /F1 12 Tf 72 720 Td (${escapePdfText(text)}) Tj ET`;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> >> >> /MediaBox [0 0 612 792] /Contents ${contentObjectId} 0 R >>`,
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`
    );
  });

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(pdf.length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xrefOffset = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.slice(1).forEach((offset) => {
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  });
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return new TextEncoder().encode(pdf).buffer;
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

  it("preserves development browser profile auth", async () => {
    const { env } = createEnv({}, { AUTH_MODE: "development" });
    const response = await worker.fetch(
      new Request("https://example.com/api/me?clientId=browser-1"),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: "browser-1",
        authenticated: false
      }
    });
  });

  it("rejects missing Cloudflare Access auth in access mode", async () => {
    const { env } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/me?clientId=browser-1"),
      env
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Sign in with Cloudflare Access to continue."
    });
  });

  it("accepts valid Cloudflare Access JWTs and maps identity", async () => {
    const { token, publicJwk } = await createAccessJwt({});
    mockAccessCerts(publicJwk);
    const { env } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/me?clientId=spoofed", {
        headers: {
          "Cf-Access-Jwt-Assertion": token
        }
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      user: {
        id: "access:user-123",
        email: "access@example.com",
        name: "Access User",
        authenticated: true
      }
    });
  });

  it("rejects invalid Cloudflare Access JWT audiences", async () => {
    const { token, publicJwk } = await createAccessJwt({ audience: "wrong-aud" });
    mockAccessCerts(publicJwk);
    const { env } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/me", {
        headers: {
          "Cf-Access-Jwt-Assertion": token
        }
      }),
      env
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cloudflare Access token audience is invalid."
    });
  });

  it("uses access mode by default when Access settings are present", () => {
    expect(
      authTestExports.getAuthMode({
        AI: {} as Ai,
        DB: {} as D1Database,
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      })
    ).toBe("access");
  });

  it("rejects undecodable Cloudflare Access JWTs as auth failures", async () => {
    const { env } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/me", {
        headers: {
          "Cf-Access-Jwt-Assertion": "bad.token.value"
        }
      }),
      env
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: "Cloudflare Access token could not be decoded."
    });
  });

  it("caches Cloudflare Access signing keys", async () => {
    const { token, publicJwk } = await createAccessJwt({});
    const fetchMock = vi.fn(async () =>
      Response.json({
        keys: [publicJwk]
      })
    );
    vi.stubGlobal("fetch", fetchMock);
    const { env } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );

    for (let index = 0; index < 2; index += 1) {
      const response = await worker.fetch(
        new Request("https://example.com/api/me", {
          headers: {
            "Cf-Access-Jwt-Assertion": token
          }
        }),
        env
      );
      expect(response.status).toBe(200);
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses Access login and logout links when configured", () => {
    const { env } = createEnv(
      {},
      { ACCESS_TEAM_DOMAIN: "https://team.example.com" }
    );

    expect(getAuthLinks(env)).toEqual({
      loginUrl: "https://team.example.com/cdn-cgi/access/login",
      logoutUrl: "https://team.example.com/cdn-cgi/access/logout"
    });
  });

  it("ignores spoofed client ids when Access auth is active", async () => {
    const { token, publicJwk } = await createAccessJwt({});
    mockAccessCerts(publicJwk);
    const { env, calls } = createEnv(
      {},
      {
        AUTH_MODE: "access",
        ACCESS_TEAM_DOMAIN: "https://team.example.com",
        ACCESS_AUD: "aud-123"
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions", {
        method: "POST",
        headers: {
          "Cf-Access-Jwt-Assertion": token
        },
        body: JSON.stringify({
          clientId: "browser-spoof",
          role: "Frontend Engineer",
          level: "Senior",
          focus: "behavioral"
        })
      }),
      env
    );

    expect(response.status).toBe(201);
    const sessionInsert = calls.find((call) =>
      call.sql.includes("INSERT INTO sessions")
    );
    expect(sessionInsert?.params[1]).toBe("access:user-123");
    expect(sessionInsert?.params[2]).toBe("access:user-123");
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
      "behavioral",
      expect.stringContaining("Warm-up"),
      JSON.stringify({ stageIndex: 0, questionInStage: 0, completed: false }),
      0,
      "realistic",
      "standard"
    ]);
  });

  it("creates sessions with coaching settings", async () => {
    const { env, calls } = createEnv();
    const response = await worker.fetch(
      new Request("https://example.com/api/sessions", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          role: "Frontend Engineer",
          level: "Senior",
          focus: "technical leadership",
          useCrossSessionMemory: true,
          interviewerPersona: "strict",
          difficulty: "senior"
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
      "Frontend Engineer",
      "Senior",
      "technical leadership",
      "",
      "",
      "",
      "quick_practice",
      "behavioural",
      "leadership",
      expect.stringContaining("Warm-up"),
      JSON.stringify({ stageIndex: 0, questionInStage: 0, completed: false }),
      1,
      "strict",
      "senior"
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

  it("streams chat replies with updated interview progress", async () => {
    const { env, calls, aiCalls } = createChatEnv([
      {
        id: 1,
        sessionId: "session-1",
        role: "assistant",
        content: "Tell me about a project where you improved reliability.",
        createdAt: new Date(0).toISOString()
      }
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        headers: { Accept: "text/event-stream" },
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message:
            "I led a three-engineer migration project, owned the rollout plan, added reliability dashboards, reduced upload failures by 32%, monitored rollback risk during launch, and reviewed alerts daily with support.",
          stream: true
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toContain("text/event-stream");
    const body = await response.text();
    expect(body).toContain("event: done");
    expect(body).toContain('"interviewProgress"');
    expect(body).toContain('"stageIndex":1');
    expect(aiCalls).toHaveLength(1);
    expect(calls.some((call) => call.params.includes("assistant"))).toBe(true);
  });

  it("starts the interview without storing the action as a user turn", async () => {
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
    ).toBe(false);
  });

  it("advances structured progress when a candidate answers an interviewer question", async () => {
    const { env, calls, aiCalls } = createChatEnv([
      {
        id: 1,
        sessionId: "session-1",
        role: "assistant",
        content: "Tell me about a project where you improved reliability.",
        createdAt: new Date(0).toISOString()
      },
      {
        id: 2,
        sessionId: "session-1",
        role: "user",
        content: "I added retries and monitoring to a flaky upload service.",
        createdAt: new Date(1).toISOString()
      }
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message:
            "I reduced failed uploads by 32% by owning the retry design, adding alerts, building rollback dashboards, coordinating a staged launch across three services, and reviewing incident metrics after release."
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      interviewProgress: {
        stageIndex: 1,
        questionInStage: 0,
        completed: false
      }
    });
    expect(aiCalls).toHaveLength(1);
    expect(JSON.stringify(aiCalls[0])).toContain("Next question");
    expect(
      calls.some(
        (call) =>
          call.sql.includes("UPDATE sessions") &&
          call.sql.includes("interview_progress") &&
          call.params.includes(
            JSON.stringify({
              stageIndex: 1,
              questionInStage: 0,
              completed: false
            })
          )
      )
    ).toBe(true);
  });

  it("pauses progression and asks for a retry after weak answers", async () => {
    const { env, calls, aiCalls } = createChatEnv([
      {
        id: 1,
        sessionId: "session-1",
        role: "assistant",
        content: "Tell me about a project where you improved reliability.",
        createdAt: new Date(0).toISOString()
      }
    ]);
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message: "I led a project. It went well."
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      interviewProgress: {
        stageIndex: 0,
        questionInStage: 0,
        completed: false
      }
    });
    expect(JSON.stringify(aiCalls[0])).toContain("Retry prompt");
    expect(
      calls.some(
        (call) =>
          call.sql.includes("UPDATE sessions") &&
          call.sql.includes("interview_progress")
      )
    ).toBe(false);
  });

  it("detects vague answers for coaching retries", () => {
    const session = {
      id: "session-1",
      clientId: "browser-1",
      role: "Frontend Engineer",
      level: "Senior",
      focus: "technical communication",
      cvText: "",
      jobDescription: "",
      companyName: "",
      sessionType: "technical_screen" as const,
      interviewMode: "technical" as const,
      rubricPreset: "technical" as const,
      interviewPlan: getDefaultInterviewPlan("technical_screen"),
      interviewProgress: getInitialInterviewProgress(),
      useCrossSessionMemory: false,
      interviewerPersona: "strict" as const,
      difficulty: "challenging" as const,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    };

    expect(
      answerNeedsCoachingRetry({
        session,
        answer: "I helped with things and it went well."
      })
    ).toBe(true);
    expect(
      answerNeedsCoachingRetry({
        session,
        answer:
          "I owned the cache invalidation design, tested rollback behavior, reduced p95 latency by 28%, monitored errors for a week, documented the tradeoffs for the release team, reviewed edge cases with two senior engineers, and created dashboards for deployment risk."
      })
    ).toBe(false);
  });

  it("does not advance a completed structured interview", async () => {
    const { env, calls } = createChatEnv(
      [
        {
          id: 1,
          sessionId: "session-1",
          role: "assistant",
          content: "The structured interview is complete.",
          createdAt: new Date(0).toISOString()
        }
      ],
      {
        interviewProgress: JSON.stringify({
          stageIndex: 2,
          questionInStage: 1,
          completed: true
        })
      }
    );
    const response = await worker.fetch(
      new Request("https://example.com/api/chat", {
        method: "POST",
        body: JSON.stringify({
          clientId: "browser-1",
          sessionId: "session-1",
          message: "One more detail about the final answer."
        })
      }),
      env
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      interviewProgress: {
        stageIndex: 2,
        questionInStage: 1,
        completed: true
      }
    });
    expect(
      calls.some(
        (call) =>
          call.sql.includes("UPDATE sessions") &&
          call.sql.includes("interview_progress")
      )
    ).toBe(false);
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

  it("supports generate report command and stores the report", async () => {
    const { env, calls, aiCalls } = createChatEnv();
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
    expect(aiCalls).toHaveLength(2);
    expect(aiCalls[0]).toMatchObject({ max_tokens: 1100 });
    expect(calls.some((call) => call.sql.includes("INSERT INTO session_reports"))).toBe(
      true
    );
    await expect(response.json()).resolves.toMatchObject({
      reportId: expect.any(String)
    });
    expect(calls.some((call) => call.sql.includes("user_coaching_memory"))).toBe(
      false
    );
  });

  it("updates cross-session memory only for opted-in sessions", async () => {
    const { env, calls } = createChatEnv(undefined, {
      useCrossSessionMemory: 1,
      interviewerPersona: "strict",
      difficulty: "challenging"
    });
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
    expect(
      calls.some((call) => call.sql.includes("INSERT INTO user_coaching_memory"))
    ).toBe(true);
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
      "technical",
      expect.stringContaining("Role depth"),
      JSON.stringify({ stageIndex: 0, questionInStage: 0, completed: false }),
      0,
      "realistic",
      "standard"
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
      rubricPreset: "cybersecurity",
      interviewPlan: getDefaultInterviewPlan("technical_screen"),
      interviewProgress: getInitialInterviewProgress(),
      useCrossSessionMemory: false,
      interviewerPersona: "realistic",
      difficulty: "standard",
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
      quality: "warning",
      warnings: [
        "Extracted resume text is short. Review it before starting tailored practice."
      ]
    });
  });

  it("extracts readable DOCX resumes including headers, footers, and tables", async () => {
    const docx = zipSync({
      "word/header1.xml": strToU8(
        "<w:hdr><w:p><w:r><w:t>Security Engineer Resume</w:t></w:r></w:p></w:hdr>"
      ),
      "word/document.xml": strToU8(
        "<w:document><w:body><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Designed cloud security controls</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>Automated incident triage and mentored analysts.</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:body></w:document>"
      ),
      "word/footer1.xml": strToU8(
        "<w:ftr><w:p><w:r><w:t>Clearance eligible</w:t></w:r></w:p></w:ftr>"
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
      text: expect.stringContaining("Security Engineer Resume")
    });
    await expect(extractResumeFile(file)).resolves.toMatchObject({
      text: expect.stringContaining("Automated incident triage")
    });
    await expect(extractResumeFile(file)).resolves.toMatchObject({
      text: expect.stringContaining("Clearance eligible")
    });
  });

  it("extracts readable PDF resumes with page count metadata", async () => {
    const file = new File(
      [
        createPdfBuffer([
          "Built TypeScript dashboards with measurable accessibility improvements.",
          "Led reliability reviews and improved frontend release confidence."
        ])
      ],
      "resume.pdf",
      { type: "application/pdf" }
    );

    await expect(extractResumeFile(file)).resolves.toMatchObject({
      fileName: "resume.pdf",
      fileType: "pdf",
      text: expect.stringContaining("TypeScript dashboards"),
      pageCount: 2
    });
  });

  it("rejects unsupported, oversized, unreadable, and corrupted resume uploads", async () => {
    await expect(
      extractResumeFile(new File(["hello"], "resume.rtf"))
    ).rejects.toThrow("Upload a PDF, DOCX, TXT, or Markdown resume.");

    await expect(
      extractResumeFile(new File([new ArrayBuffer(5 * 1024 * 1024 + 1)], "big.txt"))
    ).rejects.toThrow("Resume file must be 5 MB or smaller.");

    await expect(
      extractResumeFile(new File(["\u0001".repeat(100)], "broken.txt"))
    ).rejects.toThrow("unreadable text");

    await expect(
      extractResumeFile(new File(["not a pdf"], "broken.pdf"))
    ).rejects.toThrow("That PDF could not be parsed.");

    await expect(
      extractResumeFile(new File(["not a zip"], "broken.docx"))
    ).rejects.toThrow("That DOCX could not be parsed.");
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
