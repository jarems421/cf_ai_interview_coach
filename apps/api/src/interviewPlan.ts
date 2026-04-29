import type {
  InterviewPlan,
  InterviewProgress,
  InterviewStage,
  Session,
  SessionType
} from "./types";

const maxStages = 6;
const maxQuestionsPerStage = 6;

const presetStages: Record<SessionType, InterviewStage[]> = {
  quick_practice: [
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
  ],
  full_mock: [
    {
      id: "opener",
      label: "Opener",
      objective: "Start like a real interviewer with background, motivation, and role fit.",
      questionCount: 1,
      enabled: true
    },
    {
      id: "behavioural",
      label: "Behavioural",
      objective: "Ask STAR-format questions about impact, conflict, leadership, and learning.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "role_depth",
      label: "Role depth",
      objective: "Test role-specific judgment using CV projects and job requirements.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "company_fit",
      label: "Company fit",
      objective: "Probe company motivation, product understanding, and role alignment.",
      questionCount: 1,
      enabled: true
    },
    {
      id: "wrapup",
      label: "Wrap-up",
      objective: "Close with a realistic final-round question and prepare for report feedback.",
      questionCount: 1,
      enabled: true
    }
  ],
  project_defence: [
    {
      id: "project_overview",
      label: "Project overview",
      objective: "Choose a meaningful CV project and ask for concise context and ownership.",
      questionCount: 1,
      enabled: true
    },
    {
      id: "architecture",
      label: "Architecture",
      objective: "Probe design decisions, constraints, dependencies, and alternatives.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "tradeoffs",
      label: "Tradeoffs",
      objective: "Dig into failures, tradeoffs, edge cases, and what the candidate changed.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "impact",
      label: "Impact",
      objective: "Validate outcomes, metrics, lessons, and what they would improve now.",
      questionCount: 1,
      enabled: true
    }
  ],
  technical_screen: [
    {
      id: "technical_warmup",
      label: "Technical warm-up",
      objective: "Start with a practical role-relevant technical scenario.",
      questionCount: 1,
      enabled: true
    },
    {
      id: "implementation",
      label: "Implementation",
      objective: "Ask about implementation approach, constraints, data flow, and tradeoffs.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "debugging",
      label: "Debugging",
      objective: "Test debugging signals, edge cases, failure modes, and incident response.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "score",
      label: "Score",
      objective: "Ask one final calibration question before scoring technical depth.",
      questionCount: 1,
      enabled: true
    }
  ],
  company_specific: [
    {
      id: "motivation",
      label: "Motivation",
      objective: "Ask why this company and role, using the company name when available.",
      questionCount: 1,
      enabled: true
    },
    {
      id: "role_alignment",
      label: "Role alignment",
      objective: "Connect the job description requirements to the candidate's experience.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "product_culture",
      label: "Product and culture",
      objective: "Probe product understanding, mission fit, and practical contribution.",
      questionCount: 2,
      enabled: true
    },
    {
      id: "close",
      label: "Close",
      objective: "Close with a final realistic company-fit follow-up.",
      questionCount: 1,
      enabled: true
    }
  ]
};

export function getDefaultInterviewPlan(sessionType: SessionType): InterviewPlan {
  return {
    stages: presetStages[sessionType].map((stage) => ({ ...stage }))
  };
}

export function getInitialInterviewProgress(): InterviewProgress {
  return {
    stageIndex: 0,
    questionInStage: 0,
    completed: false
  };
}

export function normalizeInterviewPlan(
  input: unknown,
  sessionType: SessionType
): InterviewPlan {
  const fallback = getDefaultInterviewPlan(sessionType);
  const maybePlan = input as Partial<InterviewPlan> | null;

  if (!maybePlan || !Array.isArray(maybePlan.stages)) {
    return fallback;
  }

  const stages = maybePlan.stages
    .slice(0, maxStages)
    .map((stage, index) => {
      const fallbackStage = fallback.stages[index] ?? fallback.stages[0];
      const candidate = stage as Partial<InterviewStage>;
      const questionCount = Number(candidate.questionCount);

      return {
        id:
          typeof candidate.id === "string" && candidate.id.trim()
            ? candidate.id.trim().slice(0, 80)
            : fallbackStage.id,
        label:
          typeof candidate.label === "string" && candidate.label.trim()
            ? candidate.label.trim().slice(0, 80)
            : fallbackStage.label,
        objective:
          typeof candidate.objective === "string" && candidate.objective.trim()
            ? candidate.objective.trim().slice(0, 320)
            : fallbackStage.objective,
        questionCount:
          Number.isFinite(questionCount) && questionCount >= 0
            ? Math.min(maxQuestionsPerStage, Math.floor(questionCount))
            : fallbackStage.questionCount,
        enabled: candidate.enabled !== false
      };
    })
    .filter((stage) => stage.enabled && stage.questionCount > 0);

  return stages.length > 0 ? { stages } : fallback;
}

export function normalizeInterviewProgress(
  input: unknown,
  plan: InterviewPlan
): InterviewProgress {
  const maybeProgress = input as Partial<InterviewProgress> | null;
  if (!maybeProgress || plan.stages.length === 0) {
    return getInitialInterviewProgress();
  }

  const stageIndex = Math.min(
    Math.max(0, Math.floor(Number(maybeProgress.stageIndex) || 0)),
    Math.max(0, plan.stages.length - 1)
  );
  const stage = plan.stages[stageIndex];
  const questionInStage = Math.min(
    Math.max(0, Math.floor(Number(maybeProgress.questionInStage) || 0)),
    stage.questionCount
  );

  return {
    stageIndex,
    questionInStage,
    completed: Boolean(maybeProgress.completed)
  };
}

export function advanceInterviewProgress(
  progress: InterviewProgress,
  plan: InterviewPlan
): InterviewProgress {
  if (progress.completed || plan.stages.length === 0) {
    return progress;
  }

  const currentStage = plan.stages[progress.stageIndex];
  const nextQuestionInStage = progress.questionInStage + 1;

  if (nextQuestionInStage < currentStage.questionCount) {
    return {
      ...progress,
      questionInStage: nextQuestionInStage
    };
  }

  const nextStageIndex = progress.stageIndex + 1;
  if (nextStageIndex >= plan.stages.length) {
    return {
      stageIndex: progress.stageIndex,
      questionInStage: currentStage.questionCount,
      completed: true
    };
  }

  return {
    stageIndex: nextStageIndex,
    questionInStage: 0,
    completed: false
  };
}

export function getCurrentStage(
  plan: InterviewPlan,
  progress: InterviewProgress
) {
  return plan.stages[progress.stageIndex] ?? plan.stages[0] ?? null;
}

export function buildStageInstruction(session: Session) {
  const interviewPlan =
    session.interviewPlan ?? getDefaultInterviewPlan(session.sessionType);
  const interviewProgress =
    session.interviewProgress ?? getInitialInterviewProgress();
  const currentStage = getCurrentStage(
    interviewPlan,
    interviewProgress
  );

  if (!currentStage || interviewProgress.completed) {
    return (
      "The structured interview plan is complete. Invite the candidate to generate " +
      "a final report or ask one optional closing question if useful."
    );
  }

  const remaining = Math.max(
    1,
    currentStage.questionCount - interviewProgress.questionInStage
  );
  const personalization = [
    session.cvText &&
      "Use the candidate's CV naturally: reference relevant projects, experience, tools, achievements, or gaps where it fits.",
    session.jobDescription &&
      "Use the job description to test required skills, responsibilities, and role expectations.",
    session.companyName &&
      `Use ${session.companyName} naturally for company motivation, product understanding, mission fit, and role alignment.`
  ]
    .filter(Boolean)
    .join(" ");

  return `Current interview stage: ${currentStage.label}
Stage objective: ${currentStage.objective}
Remaining questions in this stage: ${remaining}
Ask exactly one realistic interview question for this stage. ${personalization || "Use the role, level, and focus to personalize the question."} Do not mention that you are following an internal stage plan.`;
}

export function shouldAdvanceProgress(action: string) {
  return (
    action === "first_question" ||
    action === "next_question" ||
    action === "technical_question" ||
    action === "tailored_question"
  );
}
