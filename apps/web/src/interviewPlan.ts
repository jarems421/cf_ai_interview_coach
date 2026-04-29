import type {
  InterviewPlan,
  InterviewProgress,
  InterviewStage,
  Session,
  SessionType
} from "./types";

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

export function getActiveStages(plan: InterviewPlan) {
  return plan.stages.filter((stage) => stage.enabled && stage.questionCount > 0);
}

export function getCurrentStage(session: Session) {
  const activeStages = getActiveStages(session.interviewPlan);
  return activeStages[session.interviewProgress.stageIndex] ?? activeStages[0] ?? null;
}

export function updateStageQuestionCount(
  plan: InterviewPlan,
  stageId: string,
  questionCount: number
) {
  return {
    stages: plan.stages.map((stage) =>
      stage.id === stageId
        ? {
            ...stage,
            enabled: questionCount > 0,
            questionCount: Math.max(0, Math.min(6, questionCount))
          }
        : stage
    )
  };
}
