# Architecture

This document describes the full data flow, component structure, and technology choices for the Cloudflare AI Interview Coach.

---

## Overview

```
Browser (React SPA)
    │
    │  HTTPS fetch / form actions
    ▼
Cloudflare Workers (API worker)
    │              │
    │ Workers AI   │ D1 SQL
    ▼              ▼
Llama 3.3 70B   SQLite (D1)
```

The app is a single-page React application deployed on **Cloudflare Pages**. All API calls go to a **Cloudflare Worker** that orchestrates session management, message storage, and LLM inference.

---

## Components

### Frontend — `apps/web`

| File | Responsibility |
|------|---------------|
| `src/App.tsx` | Root component. Manages all application state: sessions, messages, setup form, voice input, timed response indicator, dark/light theme. |
| `src/api.ts` | Typed wrappers around every backend endpoint (`createSession`, `listSessions`, `deleteSession`, `listMessages`, `sendChatMessage`). |
| `src/types.ts` | Shared TypeScript types for `Session`, `Message`, `SessionType`, and `InterviewMode`. |
| `src/styles.css` | Full CSS including CSS custom properties for light/dark theming, layout, and all component styles. |
| `vite.config.ts` | Vite build configuration. Production API URL is injected via `VITE_API_BASE_URL`. |

**Key React state:**

| State | Description |
|-------|-------------|
| `sessions` | List of sessions fetched from the API for the current `clientId`. |
| `activeSessionId` | Currently selected session. |
| `messages` | All messages for the active session. |
| `setup` | New session form values (role, level, focus, CV, JD, session type, interview mode). |
| `draft` | Current textarea content. Drives the timed response indicator. |
| `responseTimerSeconds` | Elapsed seconds since the user started composing an answer. Shown as a `mm:ss` badge. Turns orange at 2 min, red at 3 min. |
| `isListening` | Whether the Web Speech API is currently recording voice input. |

---

### Backend — `apps/api`

| File | Responsibility |
|------|---------------|
| `src/index.ts` | Cloudflare Worker entry point. Routes all HTTP requests, parses bodies, orchestrates DB and AI calls. |
| `src/db.ts` | All D1 SQL queries: `createSession`, `listSessions`, `getSession`, `deleteSession`, `listMessages`, `listRecentMessages`, `addMessage`, `getSummary`, `upsertSummary`. |
| `src/ai.ts` | Workers AI calls: `generateCoachReply` (coaching feedback), `generateUpdatedSummary` (memory compression), `shouldUpdateSummary` (trigger logic), `extractAiText` (normalises varied AI response shapes). |
| `src/prompts.ts` | All prompt construction: `COACH_SYSTEM_PROMPT`, `buildSessionContext` (injects role/level/CV/JD/mode/memory), `buildSummaryPrompt`. |
| `src/http.ts` | HTTP helpers: `json`, `noContent`, `readJson`, `requireString`, `optionalString`, `HttpError`. |
| `src/types.ts` | Shared TypeScript types for `Env`, `Session`, `Message`, `SessionSummary`, `SessionType`, `InterviewMode`. |

---

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check. Returns `{ ok: true }`. |
| `POST` | `/api/sessions` | Create a new session. Accepts role, level, focus, cvText, jobDescription, companyName, sessionType, interviewMode. |
| `GET` | `/api/sessions?clientId=…` | List all sessions for a client, ordered by most recently updated. |
| `DELETE` | `/api/sessions/:id?clientId=…` | Delete a session and all its messages. |
| `GET` | `/api/sessions/:id/messages` | List all messages for a session in chronological order. |
| `POST` | `/api/chat` | Send a message or trigger a coaching action. Body: `{ clientId, sessionId, message?, action? }`. |

### Chat actions

| Action | Description |
|--------|-------------|
| `message` | Candidate free-text answer. Stored as a `user` turn. |
| `first_question` | Ask the opening interview question. Not stored as a user turn. |
| `next_question` | Ask the next follow-up question. Not stored as a user turn. |
| `technical_question` | Ask a technical question appropriate to the role. |
| `tailored_question` | Generate a question grounded in the candidate's CV and job description. |
| `rubric_score` | Score the candidate's last answer across six rubric categories. |
| `scorecard` | High-level interviewer scorecard: readiness, signal, risk, drill. |
| `improve_answer` | Rewrite the candidate's last answer in STAR format with measurable impact. |
| `generate_report` | Produce a comprehensive final session report. |

---

## Data Model (D1 / SQLite)

```sql
sessions (
  id TEXT PRIMARY KEY,
  client_id TEXT NOT NULL,
  role TEXT NOT NULL,
  level TEXT NOT NULL,
  focus TEXT NOT NULL,
  cv_text TEXT NOT NULL DEFAULT '',
  job_description TEXT NOT NULL DEFAULT '',
  company_name TEXT NOT NULL DEFAULT '',
  session_type TEXT NOT NULL DEFAULT 'quick_practice',
  interview_mode TEXT NOT NULL DEFAULT 'behavioural',
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  role TEXT NOT NULL,          -- 'user' | 'assistant'
  content TEXT NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)

session_summaries (
  session_id TEXT PRIMARY KEY REFERENCES sessions(id) ON DELETE CASCADE,
  summary TEXT NOT NULL DEFAULT '',
  strengths TEXT NOT NULL DEFAULT '',
  improvement_areas TEXT NOT NULL DEFAULT '',
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

`client_id` is a UUID generated in `localStorage` on first visit. There is no authentication — isolation is purely by client ID.

---

## AI / LLM Layer

**Model:** `@cf/meta/llama-3.3-70b-instruct-fp8-fast` via Workers AI.

**Coaching call:**
1. Build a `system` message from `COACH_SYSTEM_PROMPT`.
2. Build a second `system` message from `buildSessionContext` (role, level, focus, CV, JD, session type, interview mode, compressed memory).
3. Append the last 12 messages from D1 as conversation history.
4. If a non-`message` action was requested, append the action instruction as a final `user` turn.
5. Call `ai.run(MODEL, { messages, max_tokens: 430, temperature: 0.38 })`.

**Memory compression (summary):**
- After every 4 user turns, `generateUpdatedSummary` compresses the conversation into a JSON object `{ summary, strengths, improvementAreas }` using `response_format: { type: "json_object" }`.
- The summary is upserted into `session_summaries` and injected into every subsequent coaching call to give the model persistent context without unbounded context growth.

---

## Session Types and Interview Modes

**Session types** define the overall interview format:

| Value | Label | Behaviour |
|-------|-------|-----------|
| `quick_practice` | Quick Practice | One question at a time with instant feedback |
| `full_mock` | Full Mock Interview | 5–8 questions followed by a final report |
| `project_defence` | Project Defence | Deep probing questions on a specific project |
| `technical_screen` | Technical Screen | Practical coding / system design questions |
| `company_specific` | Company-Specific | Questions tailored to the company and role |

**Interview modes** define the question style injected into the LLM system prompt:

| Value | Label | Focus |
|-------|-------|-------|
| `behavioural` | Behavioural | STAR-format real examples |
| `technical` | Technical | Implementation, system design, trade-offs |
| `project_deep_dive` | Project Deep-dive | Motivation, design, results, retrospective |
| `company_motivation` | Company Motivation | Why this company and role specifically |
| `weakness_gap` | Weakness / Gap | Self-assessment, gaps, growth mindset |
| `final_simulation` | Final Simulation | Mixed final-round realistic simulation |

---

## Deployment

| Service | Platform |
|---------|----------|
| React SPA | Cloudflare Pages |
| API Worker | Cloudflare Workers (ESM format) |
| Database | Cloudflare D1 (SQLite) |
| LLM inference | Cloudflare Workers AI |

The Pages project proxies `/api/*` to the Worker via a `_routes.json` or direct binding, so the SPA and API share the same origin in production.

### Environment variables

| Variable | Where | Description |
|----------|-------|-------------|
| `VITE_API_BASE_URL` | Pages build | Base URL of the API worker (empty string in same-origin deployments) |
| `AI` | Worker binding | Workers AI binding |
| `DB` | Worker binding | D1 database binding |

---

## Local Development

```bash
npm install           # install all workspace dependencies

npm run dev:api       # start Workers API on http://localhost:8787
npm run dev:web       # start Vite dev server on http://localhost:5173

npm test              # run Vitest unit tests (api workspace)
```

The web dev server proxies `/api` requests to the local Worker via `vite.config.ts`.

---

## Testing

Tests live in `apps/api/test/` and use **Vitest** with a hand-written D1/AI mock.

| File | Coverage |
|------|---------|
| `index.test.ts` | All HTTP routes and chat actions: health, session CRUD, chat with all action types, guard rails (no score before answer), delete session, CV/JD fields. |
| `ai.test.ts` | `extractAiText` (response shape normalisation), `shouldUpdateSummary` (trigger cadence). |
