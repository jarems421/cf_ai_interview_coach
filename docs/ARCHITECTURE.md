# Architecture

This document describes the main data flow, component structure, and technology choices for the Cloudflare AI Interview Coach.

## Overview

```text
Browser (React SPA)
  -> Cloudflare Pages
  -> Cloudflare Access, in production
  -> Cloudflare Worker API
  -> Workers AI + D1
```

The app is a single-page React application deployed on Cloudflare Pages. API calls go to a Cloudflare Worker that verifies identity, owns session and message state, builds interview prompts, and calls Workers AI.

## Components

### Frontend: `apps/web`

| File | Responsibility |
|------|----------------|
| `src/App.tsx` | Root UI, session setup/edit forms, chat, timeline, guided actions, auth/profile state. |
| `src/api.ts` | Typed API wrappers for sessions, messages, chat, resume extraction, and auth. |
| `src/types.ts` | Web-facing TypeScript types for sessions, messages, auth, persona, difficulty, and interview modes. |
| `src/styles.css` | Layout, theme, form, chat, timeline, and control styling. |
| `vite.config.ts` | Vite build and local `/api` proxy configuration. |

Key session setup fields include role, level, focus, CV text, job description, company name, session type, interview mode, interviewer persona, difficulty, and the per-session cross-session memory toggle.

### Backend: `apps/api`

| File | Responsibility |
|------|----------------|
| `src/index.ts` | Worker entry point, HTTP routing, auth ownership checks, chat orchestration, interview progress updates. |
| `src/auth.ts` | Cloudflare Access JWT validation plus explicit development fallback. |
| `src/db.ts` | D1 queries for sessions, messages, session summaries, reports, and user coaching memory. |
| `src/ai.ts` | Workers AI calls for coaching replies, summaries, cross-session memory, and streaming. |
| `src/prompts.ts` | System prompts, session context, persona/difficulty instructions, summary and memory prompts. |
| `src/interviewPlan.ts` | Structured stage plan, progress helpers, and role-aware question strategy. |
| `src/resume.ts` | TXT, Markdown, DOCX, and PDF extraction with quality metadata and parser errors. |
| `src/types.ts` | Shared API types for environment, auth user, session, progress, messages, summaries, and memory. |

## Authentication And Ownership

The Worker supports two modes:

| Mode | Use | Behavior |
|------|-----|----------|
| `AUTH_MODE=access` | Production | Verifies the Cloudflare Access JWT from `Cf-Access-Jwt-Assertion` or `CF_Authorization`, validates issuer, audience, expiry, and signature, then derives ownership from the Access subject. |
| `AUTH_MODE=development` | Local development and tests | Allows the browser profile id fallback so local work does not require an Access app. |

Production sessions are keyed by the verified Access-derived user id. Spoofed browser `clientId` values are ignored in Access mode. The local profile fallback is not secure authentication and should only be used for local development.

## HTTP API

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/health` | Health check. |
| `GET` | `/api/me` | Returns the authenticated Access user or local development profile details. |
| `POST` | `/api/sessions` | Creates a session with interview settings and optional CV/JD context. |
| `GET` | `/api/sessions` | Lists sessions owned by the current user. |
| `PATCH` | `/api/sessions/:id` | Updates setup fields, persona, difficulty, and memory preference. |
| `DELETE` | `/api/sessions/:id` | Deletes a session and related data. |
| `GET` | `/api/sessions/:id/messages` | Lists session messages. |
| `POST` | `/api/chat` | Sends a candidate answer or runs a coaching action. |
| `POST` | `/api/resume` | Extracts resume text and metadata from an uploaded file. |

Primary interview actions are `first_question`, `message`, and `generate_report`. Rubric scoring, scorecards, and answer improvement remain available as feedback tools and do not advance structured progress.

## Data Model

The main D1 tables are:

| Table | Purpose |
|-------|---------|
| `sessions` | Session setup, owner id, interview progress, persona, difficulty, and cross-session memory preference. |
| `messages` | User and assistant chat turns. |
| `session_summaries` | Current-session compressed memory. |
| `session_reports` | Generated final reports. |
| `user_coaching_memory` | Opt-in user-level coaching memory across sessions. |

`user_coaching_memory` stores recurring strengths, recurring weaknesses, preferred role themes, and recommendations. It is read and updated only when the current session has `use_cross_session_memory = 1`.

## AI Flow

For a normal candidate answer:

1. Store the user answer.
2. Load the session, recent messages, session summary, and optional user coaching memory.
3. Decide whether the answer is too vague to progress.
4. Build system context with role, level, focus, CV/JD, interview mode, persona, difficulty, current-session memory, and opt-in cross-session memory.
5. Ask Workers AI for brief feedback, strongest signal, highest-impact upgrade, and either a retry prompt or exactly one next planned question.
6. Store the assistant response.
7. Advance `interview_progress` only when the assistant moves to the next planned question.
8. Periodically update session summary; update user coaching memory only for opted-in sessions.

Final reports are prompted to cite transcript evidence for strongest answer, weakest answer, repeated patterns, role/JD/CV alignment, and the next practice plan.

## Interview Strategy

The structured plan stays dynamic rather than using a static question bank. Stage instructions adapt by mode:

| Mode | Strategy |
|------|----------|
| `behavioural` | STAR ownership, conflict, impact, learning. |
| `technical` | Constraints, edge cases, debugging, tradeoffs. |
| `project_deep_dive` | Architecture, alternatives, failures, metrics. |
| `company_motivation` | Company knowledge, role fit, practical contribution. |
| `weakness_gap` | Self-awareness, growth, mitigation, evidence. |
| `final_simulation` | Mixed realistic final-round pressure. |

Persona and difficulty controls tune the pressure level without changing the underlying schema.

## Local Development

```bash
npm install
npm run db:local
npm run dev:api
npm run dev:web
```

The Vite dev server proxies `/api` to the local Worker. Use `AUTH_MODE=development` in `.dev.vars` for local browser-profile fallback.

## Verification

```bash
npm run typecheck
npm test
npm run eval
npm run build
npm run test:e2e
```

The deterministic eval harness writes `docs/evaluation/latest-results.json` and `docs/evaluation/latest-summary.md`.
