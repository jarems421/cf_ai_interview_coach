# Security

## Authentication

Production authentication is handled by Cloudflare Access. The Worker verifies the Access JWT from `Cf-Access-Jwt-Assertion` or the `CF_Authorization` cookie, checks issuer, audience, expiry, and signature, then derives session ownership from the Access subject.

Local development can use `AUTH_MODE=development`, which trusts a browser profile id. This mode is only for local development and demos.

## Secrets

Do not commit `.dev.vars`, `.env`, Wrangler state, tokens, Access audience values, or private test data. Use `.dev.vars.example` and `.env.example` for safe setup hints.

Production secrets should be set with Wrangler or the Cloudflare dashboard:

```bash
npx wrangler secret put AUTH_MODE
npx wrangler secret put ACCESS_TEAM_DOMAIN
npx wrangler secret put ACCESS_AUD
```

## User Data

The app stores interview sessions, messages, reports, CV text, and job descriptions in D1. Do not use real sensitive CVs in shared demos unless the deployment and retention policy are appropriate for that audience.
