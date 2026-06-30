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
and the May 2026 safety stack. Sections §0.1 through §0.21 are kept current; the
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
deno task test                                         # tests/unit only
deno test -A --no-check --ignore=frontend/,tests/e2e/  # + co-located src/ tests
```

~195 unit tests, all mocked Firestore + Bland. No emulator tests. As the backend
migrates into `src/` (see below), each feature carries a co-located `test.ts`
(business) or `smk.test.ts` (data); those run with the second command (and in
the autocheck hook), while `deno task test` still covers `tests/unit/`.

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

## Module structure (`src/`) + shape-check

The backend has been migrated into the **rune canonical shape** under
`src/<module>/{entrypoints,domain/business,domain/data}/<feature>/` so it passes
the `shape-checker` linter (mirrors the `autobottom` project). **All backend
logic now lives in `src/`** — 8 modules (core, sms-flow, crm, messaging,
reporting, scheduling, auth, dialer) plus the full kernel (firestore →
`core/data`, util/time+phone → `core/business`, types → `core/dto`, config →
`core/business`). `shared/` holds only re-export shims + the Fresh dashboard
HTML (`ui/pages.ts`). What remains is the deploy-gated finale: relocate Fresh →
`frontend/`, flip the Deno Deploy entrypoint, then delete the shims and shrink
the `HIDE` list. The full plan + status live in
[docs/shape-checker-migration.md](docs/shape-checker-migration.md).

```bash
deno task shape-check          # scoped: scans ONLY src/ (must be 0 violations)
```

Key facts:

- `deno task shape-check` runs `fixtures/scripts/shape-check.sh`, which
  temporarily git-untracks everything that isn't `src/` (shape-checker discovers
  files via git), runs the checker, and restores git on exit. As modules
  migrate, their old paths drop off the wrapper's `HIDE` list.
- Migrated code lives in `src/`; the old `shared/services/*` paths become
  one-line **re-export shims** (in the untracked `shared/` tree, so they're not
  shape-checked) — every existing `@shared/...` importer keeps working
  untouched, so the app stays deployable throughout.
- Import via `@module/` aliases (`@core/`, `@sms-flow/`, `@crm/`, …) defined in
  `deno.json`. Business features = `mod.ts` + `test.ts`; data features (external
  adapters) = `mod.ts` + `smk.test.ts`; normal modules need a `mod-root.ts`;
  `core` is the exempt kernel.
- An autocheck **Stop hook** runs `shape-check` + tests whenever `src/`/
  `frontend/` change and blocks finishing on any violation (bypass:
  `.claude/no-autocheck`).

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

**Immediate injection-failure push (bot → Canary).** Separately from the nightly
pull above, the bot POSTs to Canary the moment a scheduled injection fails for
good — i.e. after the every-minute sweep has exhausted its retries
(`MAX_INJECTION_ATTEMPTS`), so transient blips that self-heal never page anyone.
Canary texts on receipt. The push is fail-safe (never throws, never blocks the
sweep) and no-ops with a warning if `CANARY_INGEST_URL` is unset. Payload:

```json
{
  "source": "sms-bot",
  "kind": "injection-failure",
  "phone": "6142967343",
  "attempts": 5,
  "ts": "2026-06-30T13:46:24.681Z",
  "error": "6142967343 — ODR injection failed: … (gave up after 5 attempts)"
}
```

Canary renders the `error` field as the SMS body, so it's a composed summary
(phone + reason + attempt count), not the raw error string.

### Required env vars

| Var                   | Value                           | Notes                                                                                                                          |
| --------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `CANARY_SECRET`       | any hard-to-guess shared secret | Must match the value given to Canary. If unset, the `/canary/*` endpoints reject every request (fail closed).                  |
| `CANARY_INGEST_URL`   | Canary's failure-ingest URL     | Where the bot POSTs immediate injection failures. If unset, the push no-ops (logs a warning) — the nightly pull is unaffected. |
| `CANARY_INGEST_TOKEN` | bearer Canary expects from us   | Auth for the push. Optional — falls back to `CANARY_SECRET` if unset.                                                          |

Set them in `env/local` for dev and in Deno Deploy settings for prod.
