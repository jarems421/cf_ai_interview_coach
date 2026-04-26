# Evaluation

This document records evaluation tests for the AI Interview Coach — covering feedback quality, rubric scoring, CV tailoring impact, follow-up relevance, and prompt comparisons.

---

## Why Evaluate?

This is not just "I used an LLM". The goal is to measure whether the system produces **reliably useful, structured, and personalised feedback**. Each test below is designed to surface concrete signal about where the prompting works well and where it needs improvement.

---

## Test 1: Score Consistency

**Goal:** Does the rubric scorer assign consistent scores when given the same answer twice?

**Method:**
1. Create a session.
2. Send the same test answer twice in separate turns.
3. Request `rubric_score` after each.
4. Compare scores across runs.

**Test Answer:**
> "In my last role, I led a backend migration from a monolith to microservices. I coordinated with three other engineers, used Kafka for event streaming, and we reduced API latency by 40%. The biggest challenge was managing data consistency during the cutover."

**Expected:** Scores within ±1 on each category across runs.

| Run | Relevance | Specificity | Technical depth | Communication | Evidence | Overall |
|-----|-----------|-------------|-----------------|---------------|----------|---------|
| 1   | TBD       | TBD         | TBD             | TBD           | TBD      | TBD     |
| 2   | TBD       | TBD         | TBD             | TBD           | TBD      | TBD     |

---

## Test 2: Rubric vs Basic Prompt Quality

**Goal:** Does structured rubric prompting produce better feedback than a generic prompt?

**Method:**
1. Run the same answer through the basic `scorecard` action.
2. Run the same answer through the new `rubric_score` action.
3. Compare depth, actionability, and specificity of feedback.

| Metric             | Basic Scorecard | Rubric Score |
|--------------------|-----------------|--------------|
| Relevance score    | TBD             | TBD          |
| Specificity score  | TBD             | TBD          |
| Actionable feedback| TBD             | TBD          |
| Follow-up quality  | TBD             | TBD          |

---

## Test 3: CV + Job Description Tailoring Impact

**Goal:** Does providing a CV and job description produce more relevant interview questions?

**Method:**
1. Create Session A with no CV or JD (generic).
2. Create Session B with a realistic CV and JD pasted in.
3. Request 3 questions from each using `first_question` / `next_question`.
4. Rate each question's relevance to the specific role (1–10).

**Sample CV snippet:**
> "Software Engineering Intern with 2 years of experience in Go, Python, and distributed systems. Built a real-time log analysis pipeline processing 50k events/sec."

**Sample JD snippet:**
> "Cloudflare is looking for a Software Engineering Intern to work on our core network stack. Candidates should be comfortable with Rust or Go, have experience with network protocols, and enjoy debugging hard systems problems."

| Question                | Session A (generic) | Session B (tailored) |
|-------------------------|---------------------|----------------------|
| Q1 relevance (1–10)     | TBD                 | TBD                  |
| Q2 relevance (1–10)     | TBD                 | TBD                  |
| Q3 relevance (1–10)     | TBD                 | TBD                  |
| Average                 | TBD                 | TBD                  |

---

## Test 4: Follow-up Relevance After Weak Answers

**Goal:** Does the AI ask better follow-up questions after a weak answer vs. a strong one?

**Method:**
1. Send a weak answer (vague, no specifics).
2. Send a strong answer (STAR format, measurable impact).
3. Compare follow-up questions generated in both cases.

**Weak answer:** "I led a project. It went well."

**Strong answer:** "I led a 3-engineer backend migration from PostgreSQL to CockroachDB across 12 production services. We reduced cross-region latency from 380ms to 95ms by co-locating frequently joined tables. The main challenge was preserving serial IDs — we wrote a migration script with dual-write for 72 hours."

| Metric                   | Weak answer follow-up | Strong answer follow-up |
|--------------------------|----------------------|------------------------|
| Specificity of follow-up | TBD                  | TBD                    |
| Probing depth            | TBD                  | TBD                    |
| Relevance                | TBD                  | TBD                    |

---

## Test 5: Session Type Differentiation

**Goal:** Does changing the session type produce meaningfully different questions?

**Method:**
1. Create 3 sessions with the same role/level but different session types:
   - Quick Practice
   - Technical Screen
   - Project Defence
2. Request the first question from each.
3. Classify each question by type (behavioural/technical/project-specific).

| Session type     | First question (summary) | Classification | Appropriate? |
|------------------|--------------------------|----------------|--------------|
| Quick Practice   | TBD                      | TBD            | TBD          |
| Technical Screen | TBD                      | TBD            | TBD          |
| Project Defence  | TBD                      | TBD            | TBD          |

---

## Test 6: Final Report Quality

**Goal:** Does the `generate_report` action produce a genuinely actionable summary?

**Method:**
1. Complete a 5-turn mock interview.
2. Request a final report.
3. Check the report against the checklist below.

**Checklist:**
- [ ] Includes an overall score
- [ ] Identifies the best answer
- [ ] Identifies the weakest answer
- [ ] Lists at least one repeated issue
- [ ] Provides STAR-specific improvement suggestions
- [ ] Includes a next practice plan

---

## Recording Results

Run each test, fill in the TBD values, and commit this file with updated results. Use the session IDs and timestamps to reproduce results.

---

## How to Run Tests

```bash
# Start local dev environment
npm run dev:api   # Workers API on localhost:8787
npm run dev:web   # React frontend on localhost:5173
```

Navigate to the app and use the session setup panel to configure each test. Use the quick action buttons to trigger rubric scores, scorecards, and final reports.
