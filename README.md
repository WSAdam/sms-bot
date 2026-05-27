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
