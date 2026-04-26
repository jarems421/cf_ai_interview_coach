import type { InterviewMode } from "./types";

export const COACH_SYSTEM_PROMPT = `You are an AI interview coach for a job candidate.

Your job is to run a realistic mock interview and help the candidate improve quickly.

Rules:
- Ask one interview question at a time.
- If the candidate has not answered a question yet, ask a targeted opening question.
- After an answer, give feedback in this compact format:
  1. Verdict: one sentence on how the answer landed.
  2. Strongest signal: the best evidence they gave.
  3. Upgrade: the highest-impact fix, ideally with example wording.
  4. Next question: one realistic follow-up question.
- Adapt to the target role, level, focus area, CV, and job description if provided.
- Calibrate difficulty to the level. Senior and staff candidates should get ambiguity, tradeoffs, leadership, and impact questions.
- Be encouraging without being vague.
- Prefer concrete revisions, metrics, tradeoffs, and example phrasing.
- Keep responses under 150 words unless the user asks for a deeper review.
- Do not over-explain the framework unless asked.
- Never claim you are a human interviewer.`;

const CV_MAX_CHARS = 1800;
const JD_MAX_CHARS = 1200;

function truncate(text: string, max: number): string {
  return text.length > max ? text.slice(0, max) + "\n[truncated]" : text;
}

export function buildSessionContext(input: {
  role: string;
  level: string;
  focus: string;
  companyName?: string;
  cvText?: string;
  jobDescription?: string;
  interviewMode?: InterviewMode;
  summary?: string;
  strengths?: string;
  improvementAreas?: string;
}) {
  const memory = [
    input.summary && `Session summary: ${input.summary}`,
    input.strengths && `Observed strengths: ${input.strengths}`,
    input.improvementAreas && `Improvement areas: ${input.improvementAreas}`
  ]
    .filter(Boolean)
    .join("\n");

  const cvSection =
    input.cvText?.trim()
      ? `\nCandidate CV/Resume:\n${truncate(input.cvText.trim(), CV_MAX_CHARS)}`
      : "";

  const jdSection =
    input.jobDescription?.trim()
      ? `\nJob Description:\n${truncate(input.jobDescription.trim(), JD_MAX_CHARS)}`
      : "";

  return `Candidate target:
- Role: ${input.role}
- Level: ${input.level}
- Company: ${input.companyName?.trim() || "not specified"}
- Interview mode: ${input.interviewMode ?? input.focus}
- Focus: ${input.focus}
${cvSection}${jdSection}
Memory:
${memory || "No prior coaching memory yet."}`;
}

export function buildFirstQuestionInstruction(
  interviewMode: InterviewMode,
  companyName: string
): string {
  const company = companyName.trim() || "the target company";

  switch (interviewMode) {
    case "technical":
      return "Start the mock interview with exactly one practical technical question for the candidate's target role and level. If a CV or job description is provided, tailor it to their tech stack or the role's requirements. Focus on tradeoffs, implementation, or system behaviour. Do not score yet.";
    case "project_deep_dive":
      return "Start a project deep-dive interview. Based on the candidate's CV, choose their most relevant project and ask one specific probing question about it — e.g. architecture decisions, why they made a technical choice, or what they would improve. Do not score yet.";
    case "company_motivation":
      return `Start the mock interview with exactly one question about the candidate's motivation for applying to ${company}. Ask about their genuine interest in the company, role, or team. Do not score yet.`;
    case "weakness_gap":
      return "Start the mock interview with exactly one constructive question about a weakness or potential gap in the candidate's profile relevant to the target role. If a CV is provided, you may reference a possible growth area. Do not score yet.";
    case "final_simulation":
      return `Start a final-round interview simulation for ${company}. Ask exactly one challenging senior-level question — this could be a values alignment question, a leadership scenario, a strategic case, or a culture-fit question. Do not score yet.`;
    case "behavioural":
    default:
      return "Start the mock interview with exactly one focused behavioural question (STAR format expected). Base it on the candidate's target role, level, and CV if provided. Do not score yet.";
  }
}

export function buildNextQuestionInstruction(
  interviewMode: InterviewMode,
  companyName: string
): string {
  const company = companyName.trim() || "the target company";

  switch (interviewMode) {
    case "technical":
      return "Continue the mock interview. Ask exactly one new technical question, building on prior answers or moving to another relevant technical area for the role. Avoid repeating earlier questions.";
    case "project_deep_dive":
      return "Continue the project deep-dive. Ask exactly one follow-up question that probes deeper into the candidate's described project — press on trade-offs, edge cases, production concerns, or lessons learned.";
    case "company_motivation":
      return `Continue the motivation-focused interview for ${company}. Ask one more question about company fit, culture alignment, or why this specific role appeals to the candidate.`;
    case "weakness_gap":
      return "Continue the weakness and gap exploration. Ask exactly one more question about a challenge, growth area, or gap relevant to the candidate's profile and target role.";
    case "final_simulation":
      return `Continue the final-round simulation for ${company}. Ask exactly one more challenging final-round question, varying the focus (e.g., move from leadership to values, or from strategy to culture).`;
    case "behavioural":
    default:
      return "Continue the mock interview. Ask exactly one new behavioural follow-up or next-stage question based on the candidate's role, level, CV, and prior answers. Avoid repeating earlier questions.";
  }
}

export function buildSummaryPrompt(transcript: string) {
  return `Update the coaching memory for this mock interview.

Return only valid JSON with these string fields:
- summary
- strengths
- improvementAreas

Keep each field under 180 characters.

Transcript:
${transcript}`;
}
