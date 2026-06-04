# sms-bot

SMS pipeline + dashboards for Monster Reservations Group. Receives
ReadyMode dialer triggers, sends Bland.ai SMS through gatekeepers,
catches Cal.com appointment bookings, schedules dialer re-injections
at appointment time, and ties everything to Quickbase sales for
attribution.

One Deno Deploy app (Fresh framework, Firestore-backed). Production:
`https://sms-bot.thetechgoose.deno.net`.

## Detailed context

Read [context.md](context.md) first — that's the canonical source
of truth covering architecture decisions, env vars, endpoints,
scheduled jobs, gotchas, and the May 2026 safety stack. Sections
§0.1 through §0.14 are kept current; the rest is historical.

For operational incidents and fixes see:

- [incident-2026-05-19.md](incident-2026-05-19.md) — Firestore
  quota incident write-up.
- [firestore-safety.md](firestore-safety.md) — Firestore read-cost
  remediation tracker.

## Local dev

```bash
deno task dev
```

Watches the project directory and reloads on change. Local needs
either a `env/local` file with the env vars from §0.3 of context.md
or `.env`, plus a Firebase service-account JSON at the path in
`GOOGLE_APPLICATION_CREDENTIALS`.

## Tests

```bash
deno task test
```

124 unit tests, all mocked Firestore + Bland. No emulator tests.

## Type-check + build

```bash
deno check main.ts             # spot-check
deno task build                # full Vite build (used by Deploy)
```

## Deploy

GitHub `main` branch auto-deploys to Deno Deploy. Push triggers a
rebuild; cron registrations are scanned at build time from literal
`Deno.cron(...)` calls in `main.ts`. Env vars are managed in the
Deno Deploy project settings. See §0.9 of context.md for the
deploy + index-publish workflow.

## Operational dashboards

- `/dashboard` — top-line stats, daily activity, drill-ins
- `/injections` — pending scheduled-injection queue + history
- `/test` — endpoint testing console + live config (Gates Config
  card)
- `/api/admin/cron-health` — last-run markers for every cron job

## Auth

Dashboard + all `/api/*` endpoints are gated behind Firebase Auth
(Google sign-in via the `keystone-fs97` Firebase project). Public
endpoints — `/trigger/*`, `/sms-callback/*`, `/cal/*`, `/healthz`,
`/sms-flow/*` — bypass auth so webhooks from ReadyMode / Bland /
Cal.com still land. The `/login` page handles sign-in; `/logout`
clears the cookie.

Required env vars (auth is **disabled and every route is public** if
any are missing — set all four on Deploy):

| Var | Value |
|---|---|
| `AUTH_FIREBASE_API_KEY` | Web API key from the keystone-fs97 Firebase console |
| `AUTH_FIREBASE_AUTH_DOMAIN` | `keystone-fs97.firebaseapp.com` |
| `AUTH_FIREBASE_PROJECT_ID` | `keystone-fs97` |
| `AUTH_SESSION_SECRET` | 32+ char random string (HMAC key for session cookies) |
| `AUTH_ALLOWED_DOMAINS` | Comma-separated allowlist; default `monsterrg.com` |
| `AUTH_SESSION_TTL_SECONDS` | Session length; default `604800` (7 days) |

Add `https://sms-bot.thetechgoose.deno.net` and
`http://localhost:8000` as authorized domains in the keystone-fs97
Firebase Authentication → Settings panel before the sign-in popup
will work.
