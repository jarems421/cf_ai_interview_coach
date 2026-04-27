import type { InterviewMode, SessionType } from "./types";

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
- Adapt to the target role, level, focus area, and prior answers.
- Calibrate difficulty to the level. Senior and staff candidates should get ambiguity, tradeoffs, leadership, and impact questions.
- Be encouraging without being vague.
- Prefer concrete revisions, metrics, tradeoffs, and example phrasing.
- Keep responses under 150 words unless the user asks for a deeper review.
- Do not over-explain the framework unless asked.
- Never claim you are a human interviewer.`;

const SESSION_TYPE_CONTEXT: Record<SessionType, string> = {
  quick_practice: "Session mode: Quick Practice — one question at a time with instant feedback.",
  full_mock: "Session mode: Full Mock Interview — simulate a complete 5-8 question interview, then produce a final report.",
  project_defence: "Session mode: Project Defence — the candidate has chosen a specific project; ask deep, probing questions about it (design decisions, trade-offs, failures, improvements).",
  technical_screen: "Session mode: Technical Screen — ask practical coding, data structures, system design, or security questions appropriate to the role.",
  company_specific: "Session mode: Company-specific — tailor all questions to the company culture, tech stack, and role expectations."
};

const INTERVIEW_MODE_INSTRUCTIONS: Record<InterviewMode, string> = {
  behavioural: "Focus on STAR-format behavioural questions (Situation, Task, Action, Result). Probe for real examples.",
  technical: "Focus on technical depth, implementation details, system design, and trade-offs relevant to the role.",
  project_deep_dive: "Pick one significant project from the candidate's background and systematically probe it: motivation, design, implementation, results, and what they would change.",
  company_motivation: "Ask why the candidate wants this specific company and role. Probe for genuine knowledge of the company's mission, products, and challenges.",
  weakness_gap: "Probe for honest self-assessment: weaknesses, gaps in experience, failures, and growth areas. Look for self-awareness and a growth mindset.",
  final_simulation: "Simulate a full final-round interview: mix behavioural, technical, and culture-fit questions. Maintain a realistic interviewer tone throughout."
};

export function buildSessionContext(input: {
  role: string;
  level: string;
  focus: string;
  cvText?: string;
  jobDescription?: string;
  companyName?: string;
  sessionType?: SessionType;
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

  const tailoring = [
    input.companyName && `Target company: ${input.companyName}`,
    input.sessionType && SESSION_TYPE_CONTEXT[input.sessionType],
    input.interviewMode && `Interview mode: ${INTERVIEW_MODE_INSTRUCTIONS[input.interviewMode]}`,
    input.cvText && `Candidate CV:\n${input.cvText}`,
    input.jobDescription && `Job description:\n${input.jobDescription}`
  ]
    .filter(Boolean)
    .join("\n\n");

  const tailoringSection = tailoring ? `Tailoring context:\n${tailoring}\n\n` : "";

  return `Candidate target:
- Role: ${input.role}
- Level: ${input.level}
- Focus: ${input.focus}

${tailoringSection}Memory:
${memory || "No prior coaching memory yet."}`;
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
