# cf_ai_interview_coach

AI Interview Coach is a Cloudflare AI application for practicing interview answers. It uses a chat interface, Workers AI for coaching responses, a Worker API for coordination, and D1 for persistent session memory.

## What It Uses

- LLM: Cloudflare Workers AI with `@cf/meta/llama-3.3-70b-instruct-fp8-fast`
- Coordination: Cloudflare Worker API
- User input: React chat UI on Cloudflare Pages
- Memory/state: Cloudflare D1 sessions, messages, and rolling coaching summaries

## App Flow

1. Choose a target role, level, and interview focus.
2. Start a saved coaching session.
3. Send answers or ask for practice questions.
4. The Worker stores each turn in D1, sends recent context plus summary memory to Workers AI, stores the reply, and periodically updates coaching memory.

## Features

- Persistent mock interview sessions per browser identity.
- Context-aware coaching with recent chat history and rolling D1 memory.
- Quick actions for starting an interview, generating a scorecard, and improving the last answer.
- Markdown export for a session transcript.
- Local API tests with mocked D1 and mocked Workers AI.

## Local Setup

Install dependencies:

```bash
npm install
```

Create a local D1 database and apply migrations:

```bash
npm run db:local
```

Run the Worker API:

```bash
npm run dev:api
```

In another terminal, run the Pages frontend:

```bash
npm run dev:web
```

Open `http://localhost:5173`. The Vite dev server proxies `/api` requests to `http://localhost:8787`.

## Verification

```bash
npm run typecheck
npm test
npm run build
```

## Cloudflare Deployment

Log in to Cloudflare:

```bash
npx wrangler login
```

Create a D1 database:

```bash
npx wrangler d1 create interview_coach
```

Copy the returned `database_id` into `apps/api/wrangler.toml`.

Apply the remote migration:

```bash
npm run db:remote
```

Deploy the Worker API:

```bash
npm run deploy:api
```

Deploy the Pages frontend:

```bash
npm run deploy:web
```

Set the Pages environment variable `VITE_API_BASE_URL` to the deployed Worker URL, then redeploy Pages.

## Live Demo

Deployment is ready once Wrangler is authenticated, the Cloudflare account-specific D1 database id is added to `apps/api/wrangler.toml`, and the Pages `VITE_API_BASE_URL` environment variable points to the deployed Worker.

## Project Notes

- Browser identity is anonymous and stored in `localStorage`.
- The app keeps memory per browser client id and session id.
- No user accounts, voice input, payments, or external APIs are required for v1.
- Development prompts and AI prompt text are documented in `PROMPTS.md`.

## Future Improvements

- Add voice input using browser recording and Cloudflare AI transcription.
- Add shareable session links behind lightweight authentication.
- Add rubric presets for behavioral, system design, coding, and leadership interviews.
- Add an explicit end-of-session report stored separately from chat messages.

## Useful Cloudflare Docs

- Workers AI Llama 3.3 model: https://developers.cloudflare.com/workers-ai/models/llama-3.3-70b-instruct-fp8-fast/
- Workers AI bindings: https://developers.cloudflare.com/workers-ai/configuration/bindings/
- D1 databases: https://developers.cloudflare.com/d1/
- Pages deployments: https://developers.cloudflare.com/pages/
