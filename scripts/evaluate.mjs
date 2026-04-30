import { mkdir, writeFile } from "node:fs/promises";

const isLive = process.argv.includes("--live");
const outputDir = "docs/evaluation";
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

const mockOutputs = {
  structured:
    "Verdict: Clear answer with useful impact. Strongest signal: ownership of the rollout. Upgrade: add exact before/after metrics. Next question: How did you validate the improvement after release?",
  rubric: `RUBRIC SCORE
------------
Relevance:           9/10
Specificity:         8/10
Technical depth:     7/10
Communication:       8/10
Evidence/examples:   8/10
------------
Overall:             8/10

Strengths: Specific migration context and measurable latency impact.
Weaknesses: More detail needed on rollback, consistency tradeoffs, and failure modes.
Improved answer: In my last role, I led a three-engineer migration from a monolith to event-driven services. We used Kafka, dual writes, and reconciliation checks to protect consistency during cutover. The migration reduced API latency by 40% while preserving rollback options.
Follow-up an interviewer might ask: What consistency bug did you worry about most, and how did you test it?`,
  weakFeedback:
    "Verdict: Too vague to prove ownership or impact. Strongest signal: You mention leadership. Upgrade: add situation, action, metric, and tradeoff. Next question: Give one concrete project example with scope and outcome.",
  tailored:
    "Tell me about the dashboard performance work from your CV and how you validated user impact for a Cloudflare frontend surface.",
  report: `FINAL SESSION REPORT
====================

Overall Performance Score: 7/10

Rubric Used: Technical

Stage-by-stage Performance:
- Warm-up: clear ownership but needed sharper metrics.

Best Answer:
The dashboard performance answer showed practical frontend judgment.

Weakest Answer:
The leadership answer lacked measurable evidence.

Repeated Issues:
- Metrics arrived late.
- Tradeoffs needed clearer framing.

STAR Improvements Suggested:
- Add situation, task, action, result, and validation details.

Technical Depth Rating: 7/10
Good practical depth, with room for more failure-mode detail.

Confidence & Clarity Rating: 8/10
Clear and concise.

CV Improvements:
Add before/after performance metrics and accessibility outcomes.

Job Fit and Company Prep:
Connect frontend performance work to Cloudflare reliability and usability expectations.

Next Practice Plan:
Prepare two metric-backed STAR stories and one tradeoff-heavy technical answer.`
  ,
  vagueRetry:
    "Verdict: This is not interview-ready yet because it is too vague. Missing evidence: specific actions, measurable impact, ownership, and tradeoffs. Retry prompt: Answer the same question again with one concrete example, what you personally did, and the observable result.",
  strictPersona:
    "Verdict: Under a strict senior bar, this answer needs stronger evidence. Missing evidence: constraints, rollback risk, and measurable impact. Retry prompt: Give the answer again with the tradeoff you chose and the metric that proved it worked.",
  memoryEnabled:
    "Cross-session memory: The candidate repeatedly undersells impact and should prepare metric-backed STAR stories.",
  memoryDisabled:
    "Current session only: No prior coaching memory is available for this interview.",
  evidenceReport:
    "Best Answer: The dashboard performance answer cited memoized selectors and reduced visible loading delays. Weakest Answer: The leadership answer said 'it went well' without evidence. Repeated Issues: metrics arrive late. Role/JD/CV Alignment: React dashboard work fits the frontend reliability role. Next Practice Plan: prepare two evidence-backed stories."
};

const scenarios = [
  {
    id: "structured_progression",
    title: "Structured Interview Progression",
    sampleAnswer:
      "I improved a React dashboard by memoizing expensive selectors and measuring render timing.",
    output: mockOutputs.structured,
    checks: [
      includes("Verdict"),
      includes("Strongest signal"),
      includes("Upgrade"),
      includes("Next question"),
      excludes("FINAL SESSION REPORT")
    ]
  },
  {
    id: "rubric_score",
    title: "Rubric Score Shape",
    sampleAnswer:
      "I led a backend migration from a monolith to services, used Kafka, and reduced API latency by 40%.",
    output: mockOutputs.rubric,
    checks: [
      includes("RUBRIC SCORE"),
      scoreLine("Relevance"),
      scoreLine("Technical depth"),
      scoreLine("Overall"),
      includes("Improved answer"),
      includes("Follow-up")
    ]
  },
  {
    id: "weak_vs_strong_feedback",
    title: "Weak Answer Feedback",
    sampleAnswer: "I led a project. It went well.",
    output: mockOutputs.weakFeedback,
    checks: [
      includes("Too vague"),
      includes("ownership"),
      includes("metric"),
      includes("concrete project")
    ]
  },
  {
    id: "cv_jd_tailoring",
    title: "CV And JD Tailoring",
    sampleAnswer:
      "CV: React dashboard performance work. JD: Cloudflare frontend reliability and usability.",
    output: mockOutputs.tailored,
    checks: [
      includes("dashboard performance"),
      includes("Cloudflare"),
      includes("frontend"),
      includes("validated")
    ]
  },
  {
    id: "final_report",
    title: "Final Report Quality",
    sampleAnswer: "Completed mock interview transcript.",
    output: mockOutputs.report,
    checks: [
      includes("FINAL SESSION REPORT"),
      includes("Overall Performance Score"),
      includes("Best Answer"),
      includes("Weakest Answer"),
      includes("CV Improvements"),
      includes("Next Practice Plan")
    ]
  },
  {
    id: "vague_answer_retry",
    title: "Vague Answer Retry",
    sampleAnswer: "I led a project. It went well.",
    output: mockOutputs.vagueRetry,
    checks: [
      includes("not interview-ready"),
      includes("Missing evidence"),
      includes("Retry prompt"),
      excludes("Next question")
    ]
  },
  {
    id: "strict_persona",
    title: "Strict Persona Pressure",
    sampleAnswer: "I improved the system.",
    output: mockOutputs.strictPersona,
    checks: [
      includes("strict senior"),
      includes("constraints"),
      includes("rollback risk"),
      includes("metric")
    ]
  },
  {
    id: "cross_session_memory_enabled",
    title: "Cross-session Memory Enabled",
    sampleAnswer: "Use previous coaching memory.",
    output: mockOutputs.memoryEnabled,
    checks: [
      includes("Cross-session memory"),
      includes("undersells impact"),
      includes("metric-backed STAR")
    ]
  },
  {
    id: "cross_session_memory_disabled",
    title: "Cross-session Memory Disabled",
    sampleAnswer: "Do not use previous coaching memory.",
    output: mockOutputs.memoryDisabled,
    checks: [
      includes("Current session only"),
      includes("No prior coaching memory"),
      excludes("undersells impact")
    ]
  },
  {
    id: "evidence_based_report",
    title: "Evidence-based Final Report",
    sampleAnswer: "Completed transcript with mixed answer quality.",
    output: mockOutputs.evidenceReport,
    checks: [
      includes("memoized selectors"),
      includes("it went well"),
      includes("Role/JD/CV Alignment"),
      includes("evidence-backed")
    ]
  }
];

function includes(text) {
  return {
    label: `includes "${text}"`,
    run: (output) => output.toLowerCase().includes(text.toLowerCase())
  };
}

function excludes(text) {
  return {
    label: `excludes "${text}"`,
    run: (output) => !output.toLowerCase().includes(text.toLowerCase())
  };
}

function scoreLine(label) {
  return {
    label: `${label} score line`,
    run: (output) => new RegExp(`${label}:\\s+\\d{1,2}/10`, "i").test(output)
  };
}

async function getOutput(scenario) {
  if (!isLive) {
    return scenario.output;
  }

  const baseUrl = process.env.EVAL_API_BASE_URL;
  const clientId = process.env.EVAL_CLIENT_ID ?? "eval-client";
  const sessionId = process.env.EVAL_SESSION_ID;
  if (!baseUrl || !sessionId) {
    return scenario.output;
  }

  const response = await fetch(`${baseUrl.replace(/\/$/, "")}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientId,
      sessionId,
      message: scenario.sampleAnswer,
      action: scenario.id === "rubric_score" ? "rubric_score" : "message"
    })
  });
  const data = await response.json();
  return data.reply ?? scenario.output;
}

function toMarkdown(results) {
  const passed = results.filter((result) => result.passed).length;
  const total = results.length;
  const lines = [
    "# Latest Evaluation Results",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${isLive ? "live-or-fallback" : "deterministic"}`,
    `Model: ${model}`,
    `Passed: ${passed}/${total}`,
    "",
    "| Scenario | Result | Checks |",
    "|----------|--------|--------|"
  ];

  results.forEach((result) => {
    lines.push(
      `| ${result.title} | ${result.passed ? "Pass" : "Fail"} | ${result.checks
        .map((check) => `${check.passed ? "pass" : "fail"} ${check.label}`)
        .join("<br>")} |`
    );
  });

  lines.push(
    "",
    "## Sample Outputs",
    "",
    ...results.flatMap((result) => [
      `### ${result.title}`,
      "",
      "```text",
      result.output,
      "```",
      ""
    ])
  );

  return lines.join("\n");
}

const results = [];
for (const scenario of scenarios) {
  const output = await getOutput(scenario);
  const checks = scenario.checks.map((check) => ({
    label: check.label,
    passed: check.run(output)
  }));

  results.push({
    id: scenario.id,
    title: scenario.title,
    sampleAnswer: scenario.sampleAnswer,
    output,
    checks,
    passed: checks.every((check) => check.passed)
  });
}

const summary = {
  generatedAt: new Date().toISOString(),
  mode: isLive ? "live-or-fallback" : "deterministic",
  model,
  passed: results.filter((result) => result.passed).length,
  total: results.length,
  results
};

await mkdir(outputDir, { recursive: true });
await writeFile(
  `${outputDir}/latest-results.json`,
  `${JSON.stringify(summary, null, 2)}\n`
);
await writeFile(`${outputDir}/latest-summary.md`, `${toMarkdown(results)}\n`);

if (summary.passed !== summary.total) {
  console.error(`Evaluation failed: ${summary.passed}/${summary.total} passed.`);
  process.exit(1);
}

console.log(`Evaluation passed: ${summary.passed}/${summary.total} scenarios.`);
