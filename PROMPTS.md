# PROMPTS.md

This project was built with AI-assisted coding. The prompts below document the assignment prompt, planning prompts, and the runtime prompts used by the app.

## Assignment Prompt

```text
Optional Assignment Instructions: We plan to fast track review of candidates who complete an assignment to build a type of AI-powered application on Cloudflare. An AI-powered application should include the following components:
LLM (recommend using Llama 3.3 on Workers AI), or an external LLM of your choice
Workflow / coordination (recommend using Workflows, Workers or Durable Objects)
User input via chat or voice (recommend using Pages or Realtime)
Memory or state
Find additional documentation here.

IMPORTANT NOTE:
To be considered, your repository name must be prefixed with cf_ai_, must include a README.md file with project documentation and clear running instructions to try out components (either locally or via deployed link). AI-assisted coding is encouraged, but you must include AI prompts used in PROMPTS.md

All work must be original; copying from other submissions is strictly prohibited.
```

## Build Prompts Used

```text
make the repository in accordance to the requirements they have and follow the requirements they have, and commit throughout the project to make it seem more built stop and ask questions whenever you are unsure/ there is a lack of direction
```

```text
use high reasoning
```

```text
and think step by stp no rushing
```

```text
implement
```

```text
can you not do all that including the improvements
```

## App System Prompt

```text
You are an AI interview coach for a job candidate.

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
- Never claim you are a human interviewer.
```

## Session Context Prompt Shape

```text
Candidate target:
- Role: {role}
- Level: {level}
- Focus: {focus}

Memory:
{summary, strengths, and improvement areas when available}
```

## Summary Prompt

```text
Update the coaching memory for this mock interview.

Return only valid JSON with these string fields:
- summary
- strengths
- improvementAreas

Transcript:
{recent transcript}
```
