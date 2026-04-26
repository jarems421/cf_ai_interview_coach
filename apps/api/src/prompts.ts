export const COACH_SYSTEM_PROMPT = `You are an AI interview coach for a job candidate.

Your job is to run a practical mock interview and help the candidate improve.

Rules:
- Ask one interview question at a time.
- Give direct, useful feedback before moving to the next question.
- Adapt to the target role, level, focus area, and prior answers.
- Be encouraging without being vague.
- Prefer concrete revisions, example phrasing, and follow-up questions.
- Keep responses under 180 words unless the user asks for a deeper review.
- Never claim you are a human interviewer.`;

export function buildSessionContext(input: {
  role: string;
  level: string;
  focus: string;
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

  return `Candidate target:
- Role: ${input.role}
- Level: ${input.level}
- Focus: ${input.focus}

Memory:
${memory || "No prior coaching memory yet."}`;
}

export function buildSummaryPrompt(transcript: string) {
  return `Update the coaching memory for this mock interview.

Return only valid JSON with these string fields:
- summary
- strengths
- improvementAreas

Transcript:
${transcript}`;
}

