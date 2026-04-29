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
    interviewPlan: quickPracticePlan,
    interviewProgress: initialProgress
  };

  await page.route("**/api/me?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({
        user: {
          id: "access:test@example.com",
          email: "test@example.com",
          name: "Test User",
          authenticated: true
        },
        loginUrl: "/cdn-cgi/access/login",
        logoutUrl: "/cdn-cgi/access/logout"
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
      interviewPlan: { stages: Array<{ label: string; questionCount: number }> };
    };

    expect(body.role).toBe("Backend Engineer");
    expect(body.cvText).toContain("Built APIs in TypeScript");
    expect(body.jobDescription).toContain("Cloudflare");
    expect(body.sessionType).toBe("full_mock");
    expect(body.interviewMode).toBe("technical");
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
});

test("shows signed-in onboarding and creates a tailored session", async ({ page }) => {

  await page.route("**/api/sessions/session-1/messages?**", async (route) => {
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ messages: [] })
    });
  });

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
    page.getByText("Send your first answer or ask for a practice question.")
  ).toBeVisible();
  await expect(
    page.getByLabel("Interview progress").getByText("Opener")
  ).toBeVisible();
  await expect(page.getByRole("button", { name: /technical drill/i })).toBeVisible();
  await expect(page.getByText("Scenario-based question")).toBeVisible();

  const voiceBox = await page.getByRole("button", { name: "Start voice input" }).boundingBox();
  const sendBox = await page.getByRole("button", { name: "Send message" }).boundingBox();

  expect(voiceBox).not.toBeNull();
  expect(sendBox).not.toBeNull();
  expect(voiceBox!.x + voiceBox!.width).toBeLessThanOrEqual(sendBox!.x);
});
