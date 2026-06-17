# sms-bot

SMS pipeline + dashboards for Monster Reservations Group. Receives ReadyMode
dialer triggers, sends Bland.ai SMS through gatekeepers, catches Cal.com
appointment bookings, schedules dialer re-injections at appointment time, and
ties everything to Quickbase sales for attribution.

One Deno Deploy app (Fresh framework, Firestore-backed). Production:
`https://sms-bot.thetechgoose.deno.net`.

## Detailed context

Read [context.md](context.md) first — that's the canonical source of truth
covering architecture decisions, env vars, endpoints, scheduled jobs, gotchas,
and the May 2026 safety stack. Sections §0.1 through §0.18 are kept current; the
rest is historical.

For operational incidents and fixes see:

- [incident-2026-05-19.md](incident-2026-05-19.md) — Firestore quota incident
  write-up.
- [firestore-safety.md](firestore-safety.md) — Firestore read-cost remediation
  tracker.

## Local dev

```bash
deno task dev
```

Watches the project directory and reloads on change. Local needs either a
`env/local` file with the env vars from §0.3 of context.md or `.env`, plus a
Firebase service-account JSON at the path in `GOOGLE_APPLICATION_CREDENTIALS`.

## Tests

```bash
deno task test
```

142 unit tests, all mocked Firestore + Bland. No emulator tests.

## Type-check + build

```bash
deno check main.ts             # spot-check
deno task build                # full Vite build (used by Deploy)
```

## Formatting

```bash
deno fmt                       # auto-format
deno task check                # deno fmt --check + lint + type-check
```

A tracked pre-commit hook (`.githooks/pre-commit`) blocks commits that contain
unformatted code. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

`deno fmt`/lint skip `_fresh/` and `_source-omnisource/` (archived NestJS
reference snapshot) via the `exclude` list in `deno.json`.

## Deploy

GitHub `main` branch auto-deploys to Deno Deploy. Push triggers a rebuild; cron
registrations are scanned at build time from literal `Deno.cron(...)` calls in
`main.ts`. Env vars are managed in the Deno Deploy project settings. See §0.9 of
context.md for the deploy + index-publish workflow.

## Operational dashboards

- `/dashboard` — top-line stats, daily activity, drill-ins
- `/injections` — pending scheduled-injection queue + history
- `/test` — endpoint testing console + live config (Gates Config card)
- `/api/admin/cron-health` — last-run markers for every cron job

## Auth

Dashboard + all `/api/*` endpoints are gated behind Firebase Auth (Google
sign-in via the same Firebase project as Firestore — currently `keystone-fs97`).
Public endpoints — `/trigger/*`, `/sms-callback/*`, `/cal/*`, `/healthz`,
`/sms-flow/*` — bypass auth so webhooks from ReadyMode / Bland / Cal.com still
land. The `/login` page handles sign-in; `/logout` clears the cookie.

**ID tokens are verified locally** against Google's published JWKs (no network
round-trip per request after the keys are warm). The session secret used to sign
cookies is **derived deterministically from the service-account private key** —
no separate secret to manage.

### Required env vars

Only **one new env var** is needed beyond what the app already uses for
Firestore:

| Var                     | Value                                                                      | Notes                                                                     |
| ----------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `AUTH_FIREBASE_API_KEY` | Web API key from Firebase Console → Project Settings → Your Apps → Web app | Public identifier (safe to expose). The only thing that can't be derived. |

Auth is **disabled and every route is public** if this is missing — same
safe-default failure mode as before the feature shipped.

Reused from the existing Firestore setup:

- `FIREBASE_PROJECT_ID` — also drives the Firebase Auth project + auth domain
- `FIREBASE_SERVICE_ACCOUNT_JSON` (Deploy) or `GOOGLE_APPLICATION_CREDENTIALS`
  (local) — the private key is used to derive the session HMAC secret

Optional overrides:

| Var                        | Default                                     |
| -------------------------- | ------------------------------------------- |
| `AUTH_ALLOWED_DOMAINS`     | `monsterrg.com` (comma-separated allowlist) |
| `AUTH_SESSION_TTL_SECONDS` | `604800` (7 days)                           |

### One-time Firebase Console setup

Before the sign-in popup will work, in the Firebase Console for the project
named by `FIREBASE_PROJECT_ID`:

1. **Authentication → Sign-in method**: enable Google as a provider
2. **Authentication → Settings → Authorized domains**: add
   `sms-bot.thetechgoose.deno.net` and `localhost`

## Canary monitoring

Two bearer-authenticated endpoints let the external **Canary** monitor poll this
service. Both bypass the Firebase session gate (they're machine-to-machine) and
authenticate with a shared secret instead.

| Endpoint                          | Returns                                                                       | Canary watches                                    |
| --------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------- |
| `GET\|POST /canary/conversations` | today's outbound-send count (ET) — `conversationsStartedToday`                | `gte <floor>` (liveness: are we still texting?)   |
| `GET\|POST /canary/errors`        | yesterday's terminal errors (ET) — `totalErrors` + an `errors[]` detail array | `lte 0` (any persisted hard-break error pages us) |

Both require `Authorization: Bearer <CANARY_SECRET>` and return `401` otherwise.
On a real reading they always return `200` — the watched value, not the status
code, signals a problem.

### Required env var

| Var             | Value                           | Notes                                                                                                         |
| --------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `CANARY_SECRET` | any hard-to-guess shared secret | Must match the value given to Canary. If unset, the `/canary/*` endpoints reject every request (fail closed). |

Set it in `env/local` for dev and in Deno Deploy settings for prod.
