import type { InterviewMode, RubricPreset, SessionType } from "./types";

export const RUBRIC_LABELS: Record<RubricPreset, string> = {
  behavioral: "Behavioral",
  technical: "Technical",
  system_design: "System Design",
  leadership: "Leadership",
  company_motivation: "Company Motivation",
  cybersecurity: "Cybersecurity",
  project_defence: "Project Defence"
};

export const RUBRIC_OPTIONS = Object.entries(RUBRIC_LABELS) as [
  RubricPreset,
  string
][];

export function getDefaultRubricPreset(input: {
  role?: string;
  focus?: string;
  sessionType: SessionType;
  interviewMode: InterviewMode;
}): RubricPreset {
  const search = `${input.role ?? ""} ${input.focus ?? ""}`.toLowerCase();

  if (
    search.includes("security") ||
    search.includes("cyber") ||
    search.includes("soc") ||
    search.includes("incident")
  ) {
    return "cybersecurity";
  }

  if (
    input.sessionType === "project_defence" ||
    input.interviewMode === "project_deep_dive"
  ) {
    return "project_defence";
  }

  if (
    input.sessionType === "company_specific" ||
    input.interviewMode === "company_motivation"
  ) {
    return "company_motivation";
  }

  if (
    input.sessionType === "technical_screen" ||
    input.interviewMode === "technical"
  ) {
    return "technical";
  }

  if ((input.focus ?? "").toLowerCase().includes("system design")) {
    return "system_design";
  }

  if ((input.focus ?? "").toLowerCase().includes("leadership")) {
    return "leadership";
  }

  return "behavioral";
}
