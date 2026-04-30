import { expect, test } from "@playwright/test";

test.beforeEach(async ({ page }) => {
  const quickPracticePlan = {
    stages: [
      {
        id: "warmup",
        label: "Warm-up",
        objective: "Open with one realistic role-calibrated question.",
        questionCount: 1,
        enabled: true
      },
      {
        id: "focused_drill",
        label: "Focused drill",
        objective: "Probe the candidate's stated focus area with a practical follow-up.",
        questionCount: 2,
        enabled: true
      },
      {
        id: "recap",
        label: "Recap",
        objective: "Ask one final improvement-focused question before feedback.",
        questionCount: 1,
        enabled: true
      }
    ]
  };
  const initialProgress = {
    stageIndex: 0,
    questionInStage: 0,
    completed: false
  };
  let createdSession = false;
  let createdPayload = {
    role: "Frontend Engineer",
    level: "Mid-level",
    focus: "Behavioral and technical communication",
    cvText: "React and accessibility experience.",
    jobDescription: "Cloudflare frontend role.",
    companyName: "",
    sessionType: "quick_practice",
    interviewMode: "behavioural",
    rubricPreset: "behavioral",
    interviewPlan: quickPracticePlan,
    interviewProgress: initialProgress,
    useCrossSessionMemory: false,
    interviewerPersona: "realistic",
    difficulty: "standard"
  };
  const messages: Array<{
    id: number;
    sessionId: string;
    role: "user" | "assistant";
    content: string;
    createdAt: string;
  }> = [];

  await page.route("**/api/me?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "access:test@example.com",
          email: "test@example.com",
          name: "Test User",
          authenticated: false
        },
        loginUrl: "/",
        logoutUrl: "/"
      })
    });
  });

  await page.route("**/api/sessions?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        sessions: createdSession
          ? [
              {
                id: "session-1",
                clientId: "access:test@example.com",
                ...createdPayload,
                createdAt: new Date(0).toISOString(),
                updatedAt: new Date(0).toISOString()
              }
            ]
          : []
      })
    });
  });

  await page.route("**/api/sessions", async (route) => {
    if (route.request().method() !== "POST") {
      return route.fallback();
    }

    const body = route.request().postDataJSON() as {
      role: string;
      cvText: string;
      jobDescription: string;
      sessionType: string;
      interviewMode: string;
      rubricPreset: string;
      interviewPlan: { stages: Array<{ label: string; questionCount: number }> };
      useCrossSessionMemory: boolean;
      interviewerPersona: string;
      difficulty: string;
    };

    expect(body.role).toBe("Backend Engineer");
    expect(body.cvText).toContain("Built APIs in TypeScript");
    expect(body.jobDescription).toContain("Cloudflare");
    expect(body.sessionType).toBe("full_mock");
    expect(body.interviewMode).toBe("technical");
    expect(body.rubricPreset).toBe("technical");
    expect(body.useCrossSessionMemory).toBe(true);
    expect(body.interviewerPersona).toBe("strict");
    expect(body.difficulty).toBe("challenging");
    expect(body.interviewPlan.stages[0]).toMatchObject({
      label: "Opener",
      questionCount: 2
    });
    createdPayload = {
      ...createdPayload,
      ...body,
      interviewProgress: initialProgress
    };
    createdSession = true;

    await route.fulfill({
      status: 201,
      contentType: "application/json",
      body: JSON.stringify({ sessionId: "session-1" })
    });
  });

  await page.route("**/api/resume/extract", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        text: "Built APIs in TypeScript and improved latency for a production platform.",
        fileName: "resume.txt",
        fileType: "txt",
        characterCount: 70,
        quality: "warning"
      })
    });
  });

  await page.route("**/api/sessions/session-1/reports?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ reports: [] })
    });
  });

  await page.route("**/api/sessions/session-1/messages?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages })
    });
  });

  await page.route("**/api/chat", async (route) => {
    const body = route.request().postDataJSON() as {
      action?: string;
      message?: string;
    };
    let reply = "";
    let interviewProgress = createdPayload.interviewProgress;

    if (body.action === "first_question") {
      reply = "Tell me about a project where you improved a frontend experience.";
    } else if (body.message) {
      messages.push({
        id: messages.length + 1,
        sessionId: "session-1",
        role: "user",
        content: body.message,
        createdAt: new Date().toISOString()
      });
      interviewProgress = {
        stageIndex: 0,
        questionInStage: 1,
        completed: false
      };
      createdPayload = {
        ...createdPayload,
        interviewProgress
      };
      reply =
        "Verdict: Good signal. Strongest signal: You gave a concrete impact. Upgrade: Add the metric earlier. Next question: How did you validate the improvement?";
    } else if (body.action === "scorecard") {
      reply =
        "Overall readiness: promising. Strongest signal: clear ownership. Biggest risk: add more metrics.";
    } else {
      reply = "Continue with the current planned question.";
    }

    messages.push({
      id: messages.length + 1,
      sessionId: "session-1",
      role: "assistant",
      content: reply,
      createdAt: new Date().toISOString()
    });

    await route.fulfill({
      contentType: "text/event-stream",
      body:
        `event: delta\ndata: ${JSON.stringify({ text: reply })}\n\n` +
        `event: done\ndata: ${JSON.stringify({
          reply,
          interviewProgress
        })}\n\n`
    });
  });
});

test("shows signed-in onboarding and creates a tailored session", async ({ page }) => {

  await page.addInitScript(() => {
    class MockSpeechRecognition {
      lang = "";
      interimResults = false;
      maxAlternatives = 1;
      onresult = null;
      onerror = null;
      onend = null;
      start() {}
      stop() {}
    }

    Object.defineProperty(window, "webkitSpeechRecognition", {
      configurable: true,
      value: MockSpeechRecognition
    });
  });

  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Create Profile" })).toBeVisible();
  await page.getByLabel("Email").fill("test@example.com");
  await page.getByLabel("Name").fill("Test User");
  await page.getByRole("button", { name: /create profile/i }).click();

  await expect(page.getByText("Test User")).toBeVisible();
  await expect(
    page.getByText("Welcome back. Set up your next practice session.")
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Role" }).fill("cybersecurity");
  await expect(
    page.getByRole("option", { name: "Security Engineer", exact: true })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: "Cybersecurity Analyst" })
  ).toBeVisible();
  await expect(
    page.getByRole("option", { name: 'Use "cybersecurity"' })
  ).toBeVisible();

  await page.getByRole("textbox", { name: "Role" }).fill("Back");
  await page.getByRole("option", { name: "Backend Engineer" }).click();
  await page.getByRole("textbox", { name: "Focus" }).fill("system");
  await page.getByRole("option", { name: "System design and tradeoffs" }).click();
  await page.getByLabel("Session type").selectOption("full_mock");
  await page.locator(".planStageRow input").first().fill("2");
  await page.getByLabel("Interview mode").selectOption("technical");
  await expect(page.getByLabel("Scoring rubric").first()).toHaveValue("technical");
  await page.getByLabel("Interviewer persona").selectOption("strict");
  await page.getByLabel("Difficulty").selectOption("challenging");
  await page.getByLabel("Use memory from previous sessions").check();

  await page.getByRole("button", { name: /add cv and job description/i }).click();
  await page
    .locator('input[type="file"]')
    .first()
    .setInputFiles({
      name: "resume.txt",
      mimeType: "text/plain",
      buffer: Buffer.from("Built APIs in TypeScript and improved latency.")
    });
  await expect(page.getByText("Loaded resume.txt.")).toBeVisible();
  await expect(
    page.getByPlaceholder("Paste your CV or key experience here...")
  ).toHaveValue(/Built APIs in TypeScript/);
  await page
    .getByPlaceholder("Paste the job description here...")
    .fill("Cloudflare frontend role.");
  await page.getByRole("button", { name: /new session/i }).click();

  await expect(
    page.getByText("Start the structured interview, then answer each question.")
  ).toBeVisible();
  await expect(
    page.getByLabel("Interview progress").getByText("Opener")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /start interview/i })).toBeVisible();
  await expect(page.getByText("Begin with the first question")).toBeVisible();

  const voiceBox = await page.getByRole("button", { name: "Start voice input" }).boundingBox();
  const sendBox = await page.getByRole("button", { name: "Send message" }).boundingBox();

  expect(voiceBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect(voiceBox!.x + voiceBox!.width).toBeLessThanOrEqual(sendBox!.x);

  await page.getByRole("button", { name: /start interview/i }).click();
  await expect(page.getByText(/Tell me about a project/)).toBeVisible();

  await page
    .getByPlaceholder("Type your answer to the current interview question...")
    .fill("I improved the dashboard by reducing render work and measuring load time.");
  await page.getByRole("button", { name: "Send message" }).click();
  await expect(page.getByText(/How did you validate the improvement/)).toBeVisible();
  await expect(page.getByLabel("Interview progress").getByText("Opener")).toBeVisible();
  await expect(page.getByLabel("Interview progress").getByText("2/2")).toBeVisible();

  await page.getByRole("button", { name: /technical score/i }).click();
  await expect(page.getByLabel("Interview progress").getByText("2/2")).toBeVisible();
});
