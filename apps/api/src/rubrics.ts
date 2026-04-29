import type { InterviewMode, RubricPreset, Session, SessionType } from "./types";

export const RUBRIC_LABELS: Record<RubricPreset, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  system_design: "System Design",
  leadership: "Leadership",
  company_motivation: "Company Motivation",
  cybersecurity: "Cybersecurity",
  project_defence: "Project Defence"
};

const RUBRIC_CRITERIA: Record<RubricPreset, string[]> = {
  behavioral: [
    "STAR structure and narrative clarity",
    "specific ownership and decision-making",
    "measurable impact and evidence",
    "reflection, learning, and maturity"
  ],
  technical: [
    "technical correctness",
    "constraints, edge cases, and failure modes",
    "implementation judgment and tradeoffs",
    "debugging signals and communication"
  ],
  system_design: [
    "requirements and assumptions",
    "architecture, data flow, and APIs",
    "scalability, reliability, and observability",
    "tradeoffs, bottlenecks, and operational risk"
  ],
  leadership: [
    "scope of influence and ownership",
    "stakeholder management",
    "conflict resolution and prioritization",
    "team impact and durable outcomes"
  ],
  company_motivation: [
    "company and product understanding",
    "role alignment",
    "mission and culture fit",
    "specific reasons and thoughtful questions"
  ],
  cybersecurity: [
    "threat modeling and risk judgment",
    "detection, response, and investigation depth",
    "secure engineering practices",
    "business impact and communication under pressure"
  ],
  project_defence: [
    "project ownership and context",
    "architecture and decision quality",
    "tradeoffs, failures, and lessons",
    "results, metrics, and CV-strength evidence"
  ]
};

export function normalizeRubricPreset(
  value: unknown,
  sessionType: SessionType,
  interviewMode: InterviewMode,
  role = "",
  focus = ""
): RubricPreset {
  if (
    value === "behavioral" ||
    value === "technical" ||
    value === "system_design" ||
    value === "leadership" ||
    value === "company_motivation" ||
    value === "cybersecurity" ||
    value === "project_defence"
  ) {
    return value;
  }

  const search = `${role} ${focus}`.toLowerCase();
  if (
    search.includes("security") ||
    search.includes("cyber") ||
    search.includes("soc") ||
    search.includes("incident")
  ) {
    return "cybersecurity";
  }

  if (sessionType === "project_defence" || interviewMode === "project_deep_dive") {
    return "project_defence";
  }

  if (sessionType === "company_specific" || interviewMode === "company_motivation") {
    return "company_motivation";
  }

  if (interviewMode === "technical" || sessionType === "technical_screen") {
    return "technical";
  }

  if (focus.toLowerCase().includes("system design")) {
    return "system_design";
  }

  if (focus.toLowerCase().includes("leadership")) {
    return "leadership";
  }

  return "behavioral";
}

export function buildRubricInstruction(preset: RubricPreset) {
  return `${RUBRIC_LABELS[preset]} rubric criteria:
${RUBRIC_CRITERIA[preset].map((criterion) => `- ${criterion}`).join("\n")}`;
}

export function getSessionRubric(session: Session) {
  const rubricPreset = normalizeRubricPreset(
    session.rubricPreset,
    session.sessionType,
    session.interviewMode,
    session.role,
    session.focus
  );

  return {
    preset: rubricPreset,
    label: RUBRIC_LABELS[rubricPreset],
    instruction: buildRubricInstruction(rubricPreset)
  };
}
