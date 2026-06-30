# sms-bot — Consolidation Context

This packet is the starting point for consolidating three legacy systems into
one Deno Deploy project:

1. **omnisource sms-flow module** — the SMS pipeline (lead intake, ReadyMode
   injection/scrub, Bland.ai send, Cal.com appointment hook, lead
   orchestration). Code dump in `_source-omnisource/sms-flow/`.
2. **Daily cron site** — _not_ being ported. Replaced by an internal `Deno.cron`
   job (no external trigger needed).
3. **Deno KV playground** — the dashboards, conversation search, audit search,
   scheduled-injection UI, nightly Postmark report, KV CRUD, and the existing
   `/api/guests/activate` + `/api/guests/answered` + `/api/sales/record`
   endpoints. The user has saved its `main.ts` (renamed to `_legacy-main.ts`)
   into this folder as the canonical reference.

> **The original spec is below — kept as historical record.** Sections 0 + below
> "POST-IMPLEMENTATION STATE" reflect actual built state and the deltas +
> gotchas discovered during implementation. Read those first.

---

## 0. POST-IMPLEMENTATION STATE (current truth as of last commit)

### 0.1 Architecture decisions made

- **Single Fresh project** — Fresh hosts both UI pages (`routes/*.tsx`-style
  HTML) and API handlers (`routes/api/*`, `routes/sms-callback/*`,
  `routes/cal/*`, `routes/trigger/*`, `routes/sms-flow/*`). One Deno Deploy
  project, one URL.
- **NOT JSX/Fresh page templates** — UI pages are served as raw HTML strings
  extracted verbatim from `_legacy-main.ts` and stored in `shared/ui/pages.ts`.
  Each route handler returns
  `new Response(htmlConst, { headers: { "content-type": "text/html; charset=utf-8" }})`.
  No Fresh page composition for the legacy pages — kept the inline CSS + inline
  JS that the playground already had.
- **Webhooks at clean paths** — `/sms-callback/*`, `/trigger/*`, `/cal/*`,
  `/sms-flow/*`. Decided NOT to mount under `/confirmations/v001/` (that was
  legacy ngrok cruft).
- **Quickbase REAL** (was stub originally) — direct REST API in
  `shared/services/quickbase/api.ts` + `reservations.ts`. Only `getReport` (the
  daily cron data pull) still uses the public Cloud Function.
- **Cal.com integration FULL** — `shared/services/cal/service.ts` ports the
  legacy `CalService` verbatim. Three new routes under `/cal/*`.
- **No external cron, no auth tokens** — `Deno.cron` runs both the every-minute
  injection sweep and the daily QB sale-match. No `CRON_SHARED_SECRET`,
  `CRON_INTERNAL_TOKEN`, or `SMS_COUNT_TOKEN` env vars exist anymore. The
  endpoints are open (manual triggers via Test page).
- **shape-checker — being ADOPTED (was abandoned).** Originally shelved as
  incompatible with Fresh's `routes/` convention. As of 2026-06-19 we're
  migrating the backend into the rune canonical shape under `src/` so it passes,
  via a git-untrack wrapper that scopes the checker to `src/` only.
  `deno task
  shape-check` now runs that scoped wrapper (must be 0 violations).
  Full architecture + status: §0.20 and
  [docs/shape-checker-migration.md](docs/shape-checker-migration.md).
- **Reads always filter at the database; hot-path metrics use write-side
  aggregators.** After the 2026-05-19 quota incident and the follow-up cleanup,
  every code path that needs many docs uses one of: (a) a database-side `where`
  filter (single-field auto-indexed, or composite indexes in
  [firestore.indexes.json](firestore.indexes.json)), (b) a write-side
  aggregator/marker doc updated transactionally at write time, or (c) a single
  `db.get` against a known-id doc. No code path scans an unbounded collection at
  request time. The tripwire in
  [shared/firestore/wrapper.ts](shared/firestore/wrapper.ts) `list()` logs a
  stack trace if any single call returns more than
  `FIRESTORE_LIST_WARN_THRESHOLD` docs (default 500) — production code should
  rewrite the query, not raise the threshold. See
  [firestore-safety.md](firestore-safety.md) for the full inventory.

### 0.2 Critical gotchas discovered during implementation

1. **Bland send: use `/v1/sms/send`, NOT `/v1/sms/conversations`.** The latter
   is the "Create SMS Conversation" endpoint which initializes state without
   sending. We hit `https://api.bland.ai/v1/sms/send` with
   `{user_number, agent_number, pathway_id, pathway_version, new_conversation: true, request_data}`
   and **omit `agent_message`** so the pathway generates the opener. The legacy
   `BlandSmsService.createConversation` was misleadingly named — it actually
   called `/v1/sms/send`.

2. **Firestore `preferRest: true` is mandatory on Deno Deploy.**
   firebase-admin's gRPC transport doesn't work — every call hangs 50s and 500s
   with `14 UNAVAILABLE: No connection established`. Set in
   `shared/firestore/client.ts` after `getFirestore(app)`. Already wired.

3. **Vite + npm CJS modules require `new Function` for dynamic imports.** Plain
   `await import("firebase-admin/...")` AND
   `await import(/* @vite-ignore */ "...")` BOTH fail because
   @fresh/plugin-vite's deno-loader resolves them anyway. Bundle drops from 5MB
   → 250KB once you wrap:
   ```ts
   const dynamicImport = new Function("specifier", "return import(specifier)");
   const adminApp = await dynamicImport("firebase-admin/app");
   ```
   Both `shared/firestore/client.ts` and `shared/services/postmark/client.ts`
   use this pattern.

4. **`Deno.cron` types are gated `unstable` even though it's stable on Deploy.**
   Use a typed alias:
   ```ts
   type DenoCron = (name: string, schedule: string, handler: () => Promise<void> | void) => void;
   const denoCron = (Deno as unknown as { cron?: DenoCron }).cron;
   if (Deno.env.get("DENO_DEPLOYMENT_ID") && denoCron) { denoCron(...) }
   ```

5. **`QUICKBASE_USER_TOKEN` env value is the raw token string.** Quickbase's
   "copy as code" UI sometimes hands you a base64-encoded HTTP-headers blob —
   looks like `Insi…SI=`. Decode that and extract the `b…` token from the
   Authorization line.

6. **Phone field in QB is queried by formatted string.** `8432222986` → format
   to `(843) 222-2986` for `EX` queries. Done in
   `shared/services/quickbase/reservations.ts:formatPhoneForQb`.

7. **Override mode in `processInboundLead` falls through to a stub guest** if
   the CRM lookup returns null. Without this, the "fire a test SMS to your
   phone" path can't work until QB has a record for your test resID.

8. **Bland conversation-message webhook receiver was missing originally.** Built
   at `routes/sms-callback/conversation/[phone]/[callId].ts`. Bland needs to be
   configured to POST every message there or the dashboard's "People Replied"
   stays at 0 forever.

9. **Never `list()` a collection and filter in memory by a per-record field —
   always use a `where()` filter at the database.** This pattern caused the
   2026-05-19 Firestore quota incident: `getAllConversations(phone)` was listing
   the entire `conversations/messages` collection (limit 50,000) and filtering
   by `phoneNumber` in memory. Cost compounded with table size; on the day of
   the incident, normal morning dialer traffic exhausted our daily Firestore
   read quota and the app started 500ing. Fix at
   [shared/services/conversations/store.ts](shared/services/conversations/store.ts):
   swap to `where({field: "phoneNumber", op: "==", value: phone})`. Cost per
   call drops from "size of whole table" to "messages for that phone" (dozens).
   Tripwire at [shared/firestore/wrapper.ts](shared/firestore/wrapper.ts)
   `list()` logs a stack-trace warning when any single call returns more than
   `FIRESTORE_LIST_WARN_THRESHOLD` docs (default 500). Full incident write-up:
   [incident-2026-05-19.md](incident-2026-05-19.md). Remediation tracker:
   [firestore-safety.md](firestore-safety.md).

10. **Hot-path metrics need write-side aggregators, not read-time scans.** The
    nightly report's "Texts Sent (unique recipients)" metric was the
    second-worst offender — it scanned the entire conversations collection every
    time the report fired. Replaced with two write-side index collections
    (`uniquerecipientbyphone/byPhone` and `weeklyrecipientbyphoneweek/byKey`)
    populated by an idempotent `atomicCreate` in
    [shared/services/readymode/service.ts](shared/services/readymode/service.ts)
    → `recordOutboundRecipientMarkers` after every successful Bland send. Report
    reads now scan one week of recipients (hundreds), not the full conversations
    table. Same pattern applies to any future metric you might be tempted to
    derive from a full-table scan.

11. **Every hot-path scan is now bounded.** Same incident, broader fix completed
    in May 2026. Every site that used to list a full collection now uses either
    (a) a database-side `where` filter, (b) a write-side aggregator/marker doc,
    or (c) a single `db.get`. See [firestore-safety.md](firestore-safety.md) for
    the full inventory. New write-side collections introduced:
    - `injectedphones/byPhone/{phone10}` — `/api/guests/answered` lookup
    - `uniqueguestsbyphone/byPhone/{phone10}` — dashboard "Unique Guests"
      drill-in (updated transactionally inside `storeMessage`)
    - `metrics/daily/{YYYY-MM-DD}` + `metrics/lifetime/totals` — nightly report
      counters (incremented at every fire/activate/send site)

    Each has a one-shot backfill script in `scripts/`. Run those BEFORE the
    read-side code that depends on the aggregator ships, otherwise historical
    phones go missing.

12. **Wrapper extensions for atomic writes.**
    [shared/firestore/wrapper.ts](shared/firestore/wrapper.ts) exposes
    `incrementField`, `setMerge`, and `transactionalUpdate` on top of the basic
    `get`/`set`/`list`/`batch`/`atomicCreate`. Use `incrementField` for counters
    (atomic via `FieldValue.increment`), `setMerge` for "stamp this field, leave
    the rest alone", and `transactionalUpdate` for read-modify-write under
    concurrency (e.g. `orchestrator.updatePointer`). Don't go back to
    read-then-write — that's how the daily SMS cap could be overshot before.

### 0.3 Env vars (current canonical list)

| Var                              | Required                         | Purpose                                                | Notes                                                                                              |
| -------------------------------- | -------------------------------- | ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `FIREBASE_PROJECT_ID`            | ✅                               | GCP project ID                                         | `keystone-fs97`                                                                                    |
| `FIREBASE_SERVICE_ACCOUNT_JSON`  | ✅ on Deploy                     | Raw JSON of service account                            | Paste the whole `{...}` blob                                                                       |
| `GOOGLE_APPLICATION_CREDENTIALS` | ✅ local                         | Path to service-account JSON file                      | e.g. `./data/service-account.dev.json` (gitignored)                                                |
| `BLAND_API_KEY`                  | ✅                               | Bland.ai API key                                       | Header: `authorization: <key>` (no Bearer prefix)                                                  |
| `NU_BLAND_API_KEY`               | optional                         | Bland fallback key                                     |                                                                                                    |
| `BLAND_SMS_PATHWAY_ID`           | optional                         | Pathway override                                       | Default: `d6bd66a2-13b4-4365-a994-842c705e22b1`                                                    |
| `BLAND_PATHWAY_VERSION`          | optional                         | Pathway version                                        | Default: `production`                                                                              |
| `POSTMARK_SERVER`                | required for /api/report/nightly | Postmark server token                                  |                                                                                                    |
| `QUICKBASE_REPORT_TOKEN`         | required for daily cron          | `test` body field for `getReports` Cloud Function      |                                                                                                    |
| `QUICKBASE_USER_TOKEN`           | required for direct QB ops       | User token from QB My Preferences → Manage user tokens | Raw token only, NOT a base64 headers blob                                                          |
| `QUICKBASE_FAIL_OPEN`            | optional                         | `true` (default) = QB outage soft-fails                | Flip to `false` once you trust QB wiring                                                           |
| `RM_USER`, `RM_PASS`             | ✅                               | ReadyMode TPI Basic-auth creds                         | Same creds work for all 5 domains (no per-domain overrides needed)                                 |
| `CAL_API_KEY`                    | ✅ for Cal.com endpoints         | Cal.com v2 API key                                     | `cal_live_…` format                                                                                |
| `NGROK_KEY`                      | local dev only                   | ngrok auth token                                       | For `deno task tunnel`                                                                             |
| `SOURCE_KV_URL`                  | migration script only            | Legacy KV deploy URL                                   | `https://google-sheets-kv.thetechgoose.deno.net`                                                   |
| `INBOUND_WINDOW_MODE`            | optional                         | Inbound trigger gate mode                              | `off` \| `none` \| `explicit` \| `random`. Default `none` if unset. See §0.14                      |
| `INBOUND_WINDOW_START_ET`        | optional                         | Window start when mode=explicit                        | `HH:MM` 24h ET, default `00:00`                                                                    |
| `INBOUND_WINDOW_END_ET`          | optional                         | Window end when mode=explicit                          | `HH:MM` 24h ET, default `23:59`                                                                    |
| `FIRESTORE_LIST_WARN_THRESHOLD`  | optional                         | Tripwire for unbounded `list()` calls                  | Default 500. Logs stack trace if any single query exceeds.                                         |
| `AUTH_FIREBASE_API_KEY`          | ✅ for the auth gate             | Firebase Web API key from keystone-fs97                | Public (project identifier, not a secret). If unset → auth disabled, every route public. See §0.15 |
| `AUTH_ALLOWED_DOMAINS`           | optional                         | Comma-separated email-domain allowlist                 | Default `monsterrg.com`. Lowercased.                                                               |
| `AUTH_SESSION_TTL_SECONDS`       | optional                         | Session cookie lifetime                                | Default 604800 (7 days).                                                                           |
| `CANARY_SECRET`                  | ✅ for /canary monitoring        | Shared bearer secret the external Canary monitor sends | If unset, `/canary/*` reject every request (fail closed). See §0.16                                |

**Removed since original plan:** `CRON_SHARED_SECRET`, `CRON_INTERNAL_TOKEN`,
`SMS_COUNT_TOKEN`, `QUICKBASE_REALM` (now hardcoded constant).

### 0.4 Hardcoded constants

In `shared/config/constants.ts`:

- Bland: agent number `+18435488335`, pathway ID `d6bd66a2-…`, version
  `production`
- Quickbase: realm `monsterrg.quickbase.com`, reservations table `bmhvhc72c`,
  fields
  `{ResId:3, Email:78, GuestName:79, Phone:82, SpouseName:84, Dnc:457, TCPA:685}`,
  bookings table `bpb28qsnn`, report `530`
- Cal.com: API base `https://api.cal.com/v2`, version header `2024-08-13`, event
  type ID `4650992` (Monster Appointments), holding campaign `ODR_APPT_HOLDING`
- Postmark: from `notifications@monsterrg.com`, default to `adamp@monsterrg.com`
- Throttling: daily cap 100, rate-limit window 30d, attempts threshold 40
- Sale match: 7-day window
- Firestore root: `sms-bot`
- Time: `America/New_York` for all ET-day calculations

### 0.5 Endpoint inventory (current — supersedes §5)

**UI pages** (return HTML from `shared/ui/pages.ts`, all gated by §0.15 auth
unless listed under "Public bypass"):

- `GET /` — landing (also handles legacy audit `?recordId` GET / POST)
- `GET /dashboard`, `/search`, `/audit`, `/injections`, `/review`
- `GET /test` — endpoint test console (8 sections, ~25 cards, sticky phone
  input, override toggle, response preview)
- `GET /healthz` — `{ok:true, service, time}` (public)
- `GET /login` — Firebase Web SDK + Google sign-in button (public)
- `GET|POST /logout` — clears session cookie, 302 → /login (public)

**Trigger** (inbound SMS):

- `POST /trigger/manual` — pathway SMS via `/v1/sms/send`. Body
  `{phone, resID, domain, attempts, override?}`. Override defaults true if
  omitted (back-compat); `override:false` from Test page exercises real
  gatekeepers.
- `POST /trigger/readymode` — full gatekeeper path (attempts ≥40, DNC, rate
  limit, CRM)
- `POST /trigger/test-sms` — raw text via `/v1/sms/send`. Body
  `{phone, message}`. Bypasses pathway. Used by Custom SMS Test card.

**SMS callbacks** (Bland + Cal.com webhook receivers, dialer dispositions):

- `POST /sms-callback/appointment-booked` — `{phone, event_time}` → scrub
  source + scheduledInjection
- `POST /sms-callback/disposition` — `{phone, disposition, campaign_name}` →
  3-branch (sale/booked = noop, ODR = return-to-source, else = recycle)
- `POST /sms-callback/stop` — `{phone}` → DNC across 5 RM domains + Firestore
  flag
- `POST /sms-callback/bland-talk-now` — `{phone}` → instant ODR inject
- `POST|GET /sms-callback/return-to-source` — scrub ODR, inject back to original
- `POST /sms-callback/backfill-conversations` — `{conversationIds:[…]}`
- `POST /sms-callback/seed-conversations`,
  `POST /sms-callback/seed-conversation` — bulk/single Bland history seed
- `GET /sms-callback/list-today` — Bland's today list (sanity check API key)
- `DELETE /sms-callback/conversation-history`, `/sms-callback/cleanup` — testing
  wipes
- **`POST /sms-callback/conversation/:phone/:callId`** — **NEW.** Bland
  per-message webhook receiver. Body `{sender, message, nodeTag?}` —
  phone+callId in body ignored (URL path wins). Sender normalization:
  `"USER"`/`"GUEST"`/`"Guest"` → `"Guest"`, anything else → `"AI Bot"`. Calls
  `storeMessage` which writes the callId→phone lookup index FIRST.

**Cal.com**:

- `POST /cal/available-times` — generates 15-min slots, 9–5 ET, 7-day window,
  future-only
- `POST /cal/schedule` — Cal.com `createBooking` + `scheduleInjection` +
  auto-tag conversation history with `nodeTag: "appointment scheduled"` +
  orchestrator events. Fail-safe: SMS injection schedules even if Cal.com
  errors.
- `POST /cal/delete-scheduled-injection` — cancels both Cal.com booking (if uid
  given) and the scheduledInjection doc

**SMS-flow**:

- `GET /sms-flow/orchestrator/pointer/:phone`
- `GET /sms-flow/orchestrator/events/:phone`
- `POST /sms-flow/queue/trigger` — `{type:"INJECT_APPT", phone}` →
  fire-and-forget delayed injection

**API**:

- `GET /api/state`
- `GET|POST|DELETE /api/kv/{get,set,delete,list}` — legacy compat
- `GET /api/dashboard/{stats,drill}`, `GET /api/appointments`
- `GET /api/conversations/{search,search2}`
- `GET /api/audit/{browse,check,status}`, `POST /api/audit/save`
- `POST /api/injection/schedule`, `DELETE /api/injection/cancel`
- `GET /api/cron/trigger` — manual sweep (no auth — Deno.cron also calls)
- `GET /api/cron/trigger-single?phone=…` — fire one phone's scheduled injection
  now
- `POST /api/sales/record` — single-phone sale match
- `POST /api/guests/activate` — bulk SHA256 phone match (legacy)
- `POST /api/guests/answered` — mark answered
- `POST /api/guests/activate-from-report` — manual trigger for daily QB cron
- `POST /api/sms/count` — today's count (no auth — was token-gated, dropped)
- `GET|POST /api/report/nightly` — Postmark email
- `POST /api/auth/session` — exchange Firebase ID token for session cookie
  (public — entry to the auth flow). `DELETE` clears the cookie.

**Canary monitoring** (external monitor polls these — public bypass,
bearer-authed; see §0.16):

- `GET|POST /canary/conversations` — today's outbound-send count (ET):
  `{conversationsStartedToday, textsSentToday}` read from the `globalsmscount`
  counter. Liveness; Canary alerts if it drops below a floor.
- `GET|POST /canary/errors` — yesterday's terminal failures (ET):
  `{totalErrors, errors[]}` from `injectionhistory` status="error" + `cronruns`
  lastStatus="error".

### 0.6 Scheduled jobs (Deno.cron, Deploy-only)

In `main.ts`, gated on `DENO_DEPLOYMENT_ID` (six jobs). Each handler is wrapped
in `recordCronRun(name, fn)` so the cron-health card at `/api/admin/cron-health`
surfaces stale crons within hours rather than days.

- **`scheduled-injection-sweep-v2`** — every minute (`* * * * *`). Reads pending
  `scheduledinjections` where `eventTime <= now`, fires each through
  `handleDelayedInjection` (which has the 72h dedup guard), writes
  `injectionhistory`, deletes the pending doc. Guarded by
  `gatesConfig.scheduledInjectionSweepEnabled` (default `false`) — a
  live-editable kill-switch you can flip without a redeploy. Renamed from
  `scheduled-injection-sweep` on 2026-05-25 because Deno Deploy's runtime had
  gotten stuck on the original name (28k errors over 30 days, handler body never
  invoked); the old registration is orphaned and decays naturally.
  - ⚠️ **Phantom-injection bug (fixed 2026-06-24).** RM's lead-api rejects the
    ENTIRE lead if it sees an unrecognized field name, returning **HTTP 200**
    with `{"0":{"Accepted":false,"Error":"Field not recognized"}}`. Two stacked
    bugs in `injectLead`
    ([lead-service/mod.ts](src/dialer/domain/business/lead-service/mod.ts)) made
    every scheduled-appointment auto-injection silently fail: (1) the normalized
    `notes` field was sent **raw** instead of the domain's RM field (ODR/ACT
    want `Custom_52`), so RM rejected the lead; (2) the success check fell back
    to `res.ok`, so an `Accepted:false`+HTTP-200 was recorded as
    `status:success` and the sweep logged `✅ fired` — a lead that never entered
    RM and was never dialed. Fix: `buildLeadUrl` now maps `notes` via
    `leadFieldFor(domain, "notes")`, and `injectBodyExplicitlyRejected` makes
    the success verdict honor the body over the HTTP code (so any future
    unrecognized field surfaces loudly instead of phantom-succeeding). The
    inject log now includes the response body on both ✅ and ❌.
- **`metrics-kvbreakdown-refresh`** — `0 6 * * *` UTC = 2 AM EDT. Re-counts
  every Firestore collection and overwrites `metrics/kvBreakdown/totals`.
  Self-healing floor for the dashboard sidebar.
- **`nightly-conversation-reseed`** — `0 7 * * *` UTC = 3 AM EDT. Re-pulls every
  Bland conversation from the previous ET day + chained
  `scanConversationsForBookings` over that window. Catches webhook gaps and
  surfaces any booking signal Cal.com missed.
- **`nightly-report`** — `15 10 * * *` UTC = 6:15 AM EDT / 5:15 AM EST. Sends
  the daily Postmark email summary. Leads with a **"Yesterday" funnel** (SMS
  sent, calls scheduled, calls answered, bookings) read from a single
  `metrics/daily/{yesterday}` doc, above the existing week-to-date / lifetime
  totals. Fires at 6:15 AM (not 4:15) **on purpose**: yesterday's `answered` and
  `activations` aren't fully collected until `daily-qb-sale-match` (09:00 UTC)
  and `readymode-daily-pull` (09:30 UTC) run, so an earlier fire left those two
  numbers empty. Was every-minute with a `cronConfig.report.timeOfDayEt` field
  for live-editable send time; refactored 2026-05-26 to a fixed schedule. The
  `cronConfig.report.timeOfDayEt` field is vestigial (no longer read).
  `cronConfig.report.enabled` is still respected as a kill-switch, and
  `cronConfig.report.lastSentEtDate` enforces exactly-once-per-day.
  `GET|POST /api/report/nightly?force=1` test-sends past the `enabled`
  kill-switch (never stamps `lastSentEtDate`, so it won't suppress the real
  cron).
- **`daily-qb-sale-match`** — `0 9 * * *` UTC = 5 AM EDT / 4 AM EST. Pulls
  today's Quickbase report (id 678 by default, set in
  `cronConfig.qbSaleMatch.reportId`) and writes `saleswithin7d` markers for any
  phone whose `scheduledinjection` fired within the last 7 days AND has a
  matching QB sale.
- **`readymode-daily-pull`** — `30 9 * * *` UTC = 5:30 AM EDT. Logs into the
  ReadyMode portal, pages through yesterday's full call log, writes
  `calldispositions` (incl. per-call `durationSecs`), upserts `guestanswered`
  for answered calls (the shared `isAnsweredCall` gate — see §0.19), and
  increments the per-ET-day `metrics/daily.answered` counter (bucketed by the
  answered call's day, delta-applied so re-imports don't double-count). RM
  enforces single-session-per-user; as of 2026-06-18 the login does a reactive
  `logout_other_sessions=on` takeover (see §0.19) so the pull self-heals instead
  of dying when a session is already active, and on failure the real per-domain
  error (creds-redacted) is folded into the cron-health marker's `lastError`
  instead of a useless "see logs".

All six are callable via `/api/cron/trigger*` routes for manual firing.
Cron-health endpoint at `/api/admin/cron-health` returns last-run-status +
duration for each.

### 0.7 Test console (`/test`)

8 sections, ~25 cards. Each card has:

- Per-card phone input (placeholder `8432222986`); top "global phone" bar fills
  all
- Inline params (selects, dates, textareas)
- Run button → response panel below (status code colored, elapsed ms, pretty
  JSON)
- Confirm dialog on every destructive or send-real-SMS action

Sections:

1. **🚀 Trigger inbound SMS** — Manual trigger, Custom SMS, ReadyMode webhook
   (Manual + ReadyMode have `override=true` checkbox, default unchecked)
2. **📅 Cal.com / Appointment** — Appointment booked, Fire scheduled injection
   now, Manual schedule injection, Generate available times, Book Cal.com
   appointment, Cancel Cal.com appointment
3. **📞 Disposition / Hot-path** — Disposition, Talk-now, Return-to-source
4. **🛑 STOP / Opt-out** — STOP request
5. **🔍 Inspect state** — Conversation messages, Lead pointer, Orchestrator
   events, Config state
6. **📊 Misc writes** — Mark guest answered, Manual sale match, Store Bland
   message (simulates webhook)
7. **⚙️ Cron / Batch** — Sweep, Daily QB cron, Bland list-today, Dashboard
   stats, SMS count
8. **🧹 Cleanup (irreversible)** — Full reset, Delete history, Cancel injection

### 0.8 Local dev

```bash
deno task dev          # Fresh on port 5173/5174 with --env-file=env/local
deno task tunnel --env=dev    # ngrok exposing the dev server
deno task test         # ~195 unit tests in tests/unit (all mocked)
deno task build        # Vite production build
deno task migrate      # KV → Firestore one-shot
deno task shape-check  # scoped to src/ — must be 0 violations (218 w/ co-located)
deno fmt               # auto-format; deno task check = fmt --check + lint + check
```

**Formatting** — `deno fmt`/lint/check skip `**/_fresh/*` and
`_source-omnisource/` (archived NestJS reference dump, not valid Deno) via the
`exclude` list in `deno.json`. A tracked pre-commit hook
(`.githooks/pre-commit`) blocks commits containing unformatted code; enable it
once per clone with `git config core.hooksPath .githooks`. Nothing else enforces
fmt (no CI), so the hook is the guard against drift. Note `deno task
check`'s
lint step still reports pre-existing `no-unused-vars`/`no-explicit-any` debt
(mostly `_legacy-main.ts`) — separate from formatting.

`env/local` is gitignored (`env/example` is the template). Both `data/` and
`env/` are gitignored except `data/*.example` (ngrok yaml templates) and
`env/example`.

Service-account JSON for local dev: drop at `data/service-account.dev.json` and
set `GOOGLE_APPLICATION_CREDENTIALS=./data/service-account.dev.json` (default
already in `env/local`). Or set `FIREBASE_SERVICE_ACCOUNT_JSON` with the inline
JSON — that takes precedence.

**Write-side aggregator backfill scripts** — one-shots that seed the new index
collections from existing data. Idempotent; run them BEFORE deploying the
read-side code that depends on them, or historical phones go invisible. Each
scans a full source collection on purpose; bump `FIRESTORE_LIST_WARN_THRESHOLD`
to silence the safety-rail warning while they run.

```bash
FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
  deno run -A --env-file=env/local scripts/backfill-injected-phones.ts
FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
  deno run -A --env-file=env/local scripts/backfill-orchestrator-phone.ts
FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
  deno run -A --env-file=env/local scripts/backfill-unique-guests.ts
FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
  deno run -A --env-file=env/local scripts/backfill-daily-metrics.ts
```

All four accept `--dry-run` for a no-write preview. See the file headers for
what each one reads/writes.

### 0.9 Deploy

- **Project**: Deno Deploy auto-deploys from `main` branch of
  https://github.com/WSAdam/sms-bot
- **Build**: `deno task build` (Vite). Native Fresh runtime.
- **Bundle health**: server-entry ~305KB, pages chunk ~150KB. firebase-admin +
  postmark are externalized (resolved at runtime via `npm:` import map).
- **Cron tab in Deploy panel** confirms both Deno.cron jobs registered.
- **Logs**: every request logs ET-time + method + path + status + ms via
  `routes/_middleware.ts`.
- **Firestore composite indexes** live in
  [firestore.indexes.json](firestore.indexes.json) at repo root. Deploy with
  `firebase deploy --only firestore:indexes` (or the gcloud equivalent in
  [firestore-safety.md](firestore-safety.md)). Index builds run in the
  background and can take minutes-to-hours; deploy them BEFORE shipping code
  that uses them, otherwise the dependent queries return
  `9 FAILED_PRECONDITION: The query requires an index` until the build
  completes.

### 0.10 Bland webhook config (cutover guide)

Existing legacy webhook in Bland's pathway/numbers config posts to:

```
https://conf-deploy.ngrok.app/confirmations/v001/cal/conversation/{{from}}/{{callID}}
```

To dual-fire to the new app **clone the webhook** (don't replace yet) and add:

```
https://<new-deploy-url>/sms-callback/conversation/{{from}}/{{callID}}
```

Body shape works as-is (`{phoneNumber, callId, sender, message, nodeTag}`). Path
params win over body for phone+callId. Sender values `"AI Bot"` and `"Guest"`
both land correctly. Once new endpoint is verified for a few days, remove the
legacy webhook.

### 0.11 Migration script

`scripts/migrate-kv-to-firestore.ts` pulls from legacy KV deploy → writes to
Firestore.

**Idempotency**: doc paths are deterministic (built from KV key parts). Re-runs
OVERWRITE the existing Firestore doc with destructive `set()` (no
`{merge:true}`). So:

- ✅ Safe to re-run `conversations`, `auditstage`, `injectionhistory`, `audit` —
  append-only, unique keys per record
- ⚠️ DON'T re-run `scheduledinjection`, `smsflowcontext` after cutover — one row
  per phone, would clobber any fresh writes from the live app

Run per-prefix:

```bash
deno task migrate -- --prefix=conversations --limit=10000
deno task migrate -- --prefix=audit --dry-run
```

Optional future enhancement: `--skip-existing` flag (does `.get()` first) for
truly safe re-runs. Not built yet.

### 0.12 What's NOT done (vs. original plan)

- **Emulator tests** (`tests/emulator/*`) — never built. All 142 tests are
  unit + mocked. The `deno task test:emulator` task in `deno.json` still points
  at the missing dir; left in place but harmless if not invoked.
- **MostRecentPackage QB fields** — `MostRecentPackageIdDateOfBooking`,
  `MostRecentPackageIdCreditCardType`,
  `MostRecentPackageIdLast4OfCreditCardOnly` come back as empty strings from
  `findReservationByResID`. They're on a related Packages table (`bttffb64u`)
  and need a follow-up join. Bland pathway gets empty strings — no error, just
  no booking-detail interpolation.
- **Phase 6 cleanup** — `_source-omnisource/` and `_legacy-main.ts` still in
  repo as references.
- **Cal.com webhook receiver** (Cal.com → us, for booking events from outside) —
  not built. We initiate bookings, Cal.com doesn't currently call us.
- **Per-domain RM creds** — env vars exist conceptually but `RM_USER`/`RM_PASS`
  covers all 5 domains in practice.
- **`QUICKBASE_FAIL_OPEN` env var** — read by
  [shared/config/env.ts](shared/config/env.ts) but never consulted downstream.
  Fail-open behavior is hardcoded in
  [shared/services/crm/reservations.ts](shared/services/crm/reservations.ts)'s
  try/catch. Either wire it through or delete.

**Done since the original plan was written** (i.e. _not_ TODOs):

- **Firestore safety cleanup** — Parts A, B, C of
  [firestore-safety.md](firestore-safety.md) are all complete. Every
  request-path code path now filters at the database, uses a write-side
  aggregator, or does a single `db.get`. No code path scans an unbounded
  collection.
- **New write-side collections**: `injectedphones/byPhone`,
  `uniqueguestsbyphone/byPhone`, `metrics/daily/*` + `metrics/lifetime/totals`.
  See §6 schema and [firestore-safety.md](firestore-safety.md). Each has a
  backfill script in [scripts/](scripts/).
- **Wrapper extensions** — `incrementField`, `setMerge`, `transactionalUpdate`
  on `FirestoreClient` so counters and read-modify-write patterns are race-free
  without bespoke transaction blocks at call sites.
- **Composite Firestore indexes** —
  [firestore.indexes.json](firestore.indexes.json) defines the 4 composite
  indexes the new query shapes require. Deploy with
  `firebase deploy --only firestore:indexes`.

### 0.13 Memory rules (Adam's preferences)

- **Never add `Co-Authored-By` to git commits** — commits are attributed to Adam
  alone.
- **Never push without explicit approval** — commit freely, but ask before
  `git push`. Silence/acknowledgment doesn't count as approval.
- **Drain before unstick.** When reviving a paused scheduler/sweep that has a
  known backlog, drain or quarantine the backlog FIRST. The 2026-05-25 incident
  was caused by reversing this order: the sweep cron was unstuck (rename to
  `-v2`) before the 19 stale pending docs were cleared, so it tried to fire them
  all in the first tick. The ReadyMode campaign had to be manually scrubbed to
  prevent ~19 unwanted dials. Always sequence: drain (or guard) → then unstick.
  Never the reverse.
- **End of round: ask to refresh docs.** After any substantial change (a new
  endpoint, env var, behavior shift, bug fix that affects the operator's mental
  model, or anything that lands as a code commit), proactively ask before
  closing out: "want me to update context.md / README to reflect this?" This is
  for things Adam shouldn't have to remember to ask for. Skips: trivial one-line
  tweaks, comment-only changes, conversational replies. The full preference is
  also documented in [CLAUDE.md](CLAUDE.md).

### 0.14 Safety + ops changes (May 2026)

Series of incidents in May 2026 drove a wave of defense-in-depth work.
Summarized here so the patterns are findable; the original incident write-up is
[incident-2026-05-19.md](incident-2026-05-19.md) and the firestore remediation
tracker is [firestore-safety.md](firestore-safety.md).

**Sweep cron safety stack** (handler: `main.ts:71` →
`shared/services/orchestrator/queue.ts:handleDelayedInjection`):

- **Kill-switch** — `gatesConfig.scheduledInjectionSweepEnabled` (bool, default
  `false`). Checked inside the sweep handler before any work. Flip via /test →
  Gates Config form; gatesConfig is 60s-cached so the change is live within a
  minute. No redeploy.
- **72h dedup guard** — `handleDelayedInjection` queries `injectionhistory` for
  the phone before injecting. If any entry within
  `gatesConfig.scheduledInjectionDedupHours` (default 72) is found, the function
  returns `{skipped: true, reason}` and the sweep writes `injectionhistory` with
  `status: "skipped"` + `skipReason`. The scheduledinjection doc is deleted
  regardless (no value in re-evaluating forever). Single-field `phone` index on
  injectionhistory; ~50 queries per minute under heavy sweep load is well within
  budget.
- **Talk-now cleanup** —
  [routes/sms-callback/bland-talk-now.ts](routes/sms-callback/bland-talk-now.ts)
  now deletes the companion `scheduledinjections/{phone}` doc after firing.
  Closes the race that caused the 2026-05-25 near-miss: talk-now used to write
  an `injectionhistory` audit entry but leave the pending doc in place, so when
  the sweep came back from its 22-day outage it tried to re-dial the same
  phones.

**Inbound trigger window gate** (env-driven, zero Firestore reads):

The `/trigger/readymode` handler has a 4-mode gate at the top of the handler
that reads from `loadEnv()` (module-cached after first call). Outside the active
window, returns `200 {status: "skipped",
reason: "outside-window" | "mode-off"}`
in <30ms with no Firestore or TPI calls.

| `INBOUND_WINDOW_MODE` | Behavior                                                                                                                                                                                                                                        |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `none` (default)      | No gate; every trigger processes normally                                                                                                                                                                                                       |
| `off`                 | Master kill-switch; drop every trigger                                                                                                                                                                                                          |
| `explicit`            | Use `INBOUND_WINDOW_START_ET` / `INBOUND_WINDOW_END_ET`                                                                                                                                                                                         |
| `random`              | Per-day randomized 5h window, start in [09:00, 16:00] ET. Same window all day; reseeds at ET midnight. Deterministic from today's ET date via FNV-1a + MurmurHash3 fmix in [shared/util/time.ts](shared/util/time.ts) `effectiveInboundWindow`. |

Random-mode params (earliest/latest start, length) are hardcoded constants —
change requires a code change + redeploy. The /test → Gates Config card displays
today's effective window read-only.

**TZ normalization at every write site**
([shared/util/time.ts](shared/util/time.ts) `normalizeAppointmentTime`):

After repeated incidents where TZ-naive eventTimes (e.g. `"2026-06-14T07:30:00"`
with no Z/offset) fired ~4h early in EDT, the contract is now:

- `scheduleInjection` THROWS on any eventTime missing a `Z` or `±HH:MM` marker.
  Boundary guard, never disabled.
- All write paths into `scheduledinjections` (cal/schedule, appointment-booked,
  booking-scan-recovery) pipe through `normalizeAppointmentTime(raw, tz)` first.
- `getBlandDesiredTime` normalizes Bland's `variables.Desired_Time` at the
  source using `variables.timezone` (or ET fallback).
- Defense-in-depth: booking-scan also normalizes every proposed eventTime before
  returning it.

**booking-scan refactor** (2026-05-26):

[shared/services/conversations/booking-scan.ts](shared/services/conversations/booking-scan.ts):

- Reads from Firestore `conversations` collection (single `where(timestamp >=)`
  - in-memory group by `(phoneNumber, callId)`), NOT from Bland's API
    per-conversation. Replaced 1,200 sequential Bland calls per 30-day window
    with one Firestore list.
- Filters out conversations whose `callId` starts with `appt_` — those are
  bot-generated confirmations, not real Bland convos. Re-parsing our own output
  produced wrong-date proposals.
- Deleted the `nextOccurrenceFromMessages` "time-only" fallback. It re-anchored
  matches like "9:00 AM" to today's 9 AM regardless of the original message's
  date. If no confident full date can be extracted, the proposal is now
  `skippedNoTime` (placeholder injectionhistory only, no dial).
- Skips proposals whose eventTime is more than 24h in the past (`skippedPast`
  counter). Stale signals don't generate dials.
- Selectively calls `getBlandDesiredTime` only for conversations with a detected
  signal — ~50-100 Bland calls per 30-day window.

**cron-health observability** (`/api/admin/cron-health`):

Each cron handler wraps its body in `recordCronRun(name, fn)` which stamps
`metrics/cronruns/{name}` with last-run-at + status + duration on every tick.
The endpoint reads a hardcoded list of expected cron names + per-cron expected
freshness, and the dashboard surfaces any cron whose marker is stale. This is
what caught the 2026-05-25 sweep regression within hours of the marker going
stale instead of the 22 days the previous incident took. Adding a new cron
requires adding it to the `CRON_FRESHNESS_HOURS` map in
[routes/api/admin/cron-health.ts](routes/api/admin/cron-health.ts).

### 0.15 Auth (June 2026)

Dashboard + all `/api/*` endpoints are gated behind Firebase Auth (Google
sign-in via the same Firebase project as Firestore — currently `keystone-fs97`).
Shipped 2026-06-04 in commits `82ce46d`

- `658a389`. The /test page used to be wide open; now anyone hitting it gets
  bounced to /login.

**Auth flow:**

1. Unauthenticated request to a protected route → middleware 302s to
   `/login?next=<original>` (UI requests) or returns 401 JSON (API requests). UI
   vs API detected via `Accept: text/html`.
2. `/login` loads the Firebase Web SDK from gstatic, runs
   `signInWithPopup(Google)`, gets a Firebase ID token.
3. POSTs the token to `/api/auth/session`.
4. Server verifies the ID token LOCALLY (no network round-trip per request)
   against Google's published JWKs from
   `https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com`
   (cached 5 min). Validates `aud`, `iss`, `exp`, `iat`, `email_verified`.
5. Enforces email-domain allowlist (`AUTH_ALLOWED_DOMAINS`, default
   `monsterrg.com`). Non-allowlist accounts get a 403.
6. Mints a session cookie: `sms_bot_session=<payloadB64>.<sigB64>`, HttpOnly,
   SameSite=Lax, Secure (HTTPS only). Payload is `{email, exp}` JSON; signature
   is HMAC-SHA256.
7. Subsequent requests: middleware verifies the cookie signature + expiry. No
   external calls.

**Public bypass paths** (in
[shared/services/auth/middleware.ts](shared/services/auth/middleware.ts)
`PUBLIC_PREFIXES`):

- `/login`, `/logout`, `/api/auth/*` (the auth flow itself)
- `/trigger/*` (ReadyMode → us)
- `/sms-callback/*` (Bland → us)
- `/cal/*` (Cal.com → us)
- `/sms-flow/*` (queue triggers from external systems)
- `/canary/*` (Canary monitor → us; bearer-authed, see §0.16)
- `/healthz` (uptime checks)
- `/favicon.ico`

Adding a new webhook endpoint requires adding its prefix to this list or it'll
get the auth gate by default — which would silently 401 the external system.

**Env footprint — one new var:**

- `AUTH_FIREBASE_API_KEY` — the public Firebase Web API key from the
  keystone-fs97 console (Project Settings → Your apps → Web app). Public
  identifier, safe in env / not a cryptographic secret.

Everything else is derived:

- `firebaseProjectId` ← existing `FIREBASE_PROJECT_ID`
- `firebaseAuthDomain` ← `${projectId}.firebaseapp.com`
- `sessionSecret` ←
  `HMAC-SHA256(serviceAccount.private_key,
  "sms-bot/session/v1")`.
  Deterministic across restarts so cookies survive deploys; never written to
  disk. Rotate by bumping the "v1" label in
  [shared/services/auth/config.ts](shared/services/auth/config.ts).

**Failsafe:** if `AUTH_FIREBASE_API_KEY` is missing, auth is DISABLED and every
route is public. Same behavior as before the feature shipped, so a typo'd env
var can never lock the team out — but also means a missing env var silently
un-protects the dashboard. Check on each deploy.

**Firebase Console setup** (one-time, per environment):

1. Authentication → Sign-in method → enable **Google** provider.
2. Authentication → Settings → Authorized domains → add
   `sms-bot.thetechgoose.deno.net` and `localhost`.

**Critical files:**

- [routes/login.ts](routes/login.ts) — login page (HTML + Firebase Web SDK)
- [routes/logout.ts](routes/logout.ts) — clears cookie, redirects
- [routes/api/auth/session.ts](routes/api/auth/session.ts) — token → cookie
  exchange
- [shared/services/auth/config.ts](shared/services/auth/config.ts) — config +
  session-secret derivation
- [shared/services/auth/firebase.ts](shared/services/auth/firebase.ts) — local
  JWT verification
- [shared/services/auth/session.ts](shared/services/auth/session.ts) — cookie
  sign/verify
- [shared/services/auth/middleware.ts](shared/services/auth/middleware.ts) —
  gate logic
- [routes/_middleware.ts](routes/_middleware.ts) — calls `authGate(req)` before
  each handler

### 0.16 Canary monitoring (June 2026)

Two bearer-authenticated endpoints the external **Canary** monitor
(`canary.thetechgoose.deno.net`) polls on a schedule. Both are in
`PUBLIC_PREFIXES` (bypass the §0.15 session gate) and instead require
`Authorization: Bearer <CANARY_SECRET>` — a constant-time compare in
[shared/services/auth/bearer.ts](shared/services/auth/bearer.ts); missing or
wrong → 401. Always 200 on a real reading so the _value_, not the status code,
signals a problem; a non-2xx/timeout is Canary's down-detection.

- **`GET|POST /canary/conversations`** — liveness. Returns
  `conversationsStartedToday` = `textsSentToday` = today's
  `globalsmscount/byDate/{ET-date}.count` (one bump per outbound send, so it
  equals conversations opened today). No scan. Canary watches it `gte` a daily
  floor → pages if sending stalls.
  [routes/canary/conversations.ts](routes/canary/conversations.ts)
- **`GET|POST /canary/errors`** — yesterday's hard-break errors (terminal
  failures not solved by a retry), for a bug-fixing workflow. Returns
  `totalErrors` + an `errors[]` detail array, gathered by
  [shared/services/canary/errors.ts](shared/services/canary/errors.ts) from
  `injectionhistory` status="error" (the sweep only records "error" after
  `injectLead`'s retry is exhausted) + `metrics/cronruns` lastStatus="error".
  Window via `yesterdayEasternRange()`. Canary watches `totalErrors` `lte 0`.
  [routes/canary/errors.ts](routes/canary/errors.ts)

**Coverage gap:** inbound Bland-send failures (`processInboundLead` catch) and
ad-hoc direct injects are console-only, not persisted — they don't appear in
`/canary/errors`. Closing it means persisting those terminal failures at the
catch sites (deferred — a hot-path change).

**Env:** `CANARY_SECRET` (fail-closed if unset). The monitor sends it as the
bearer header; the same value is set in Deno Deploy settings.

### 0.17 Performance profiling (June 2026)

`withTiming(label, fn, thresholdMs = 1000)` in
[shared/util/timing.ts](shared/util/timing.ts) wraps an async call and logs
`⏱️  [FS-PROFILE] <label> took <ms>ms (ok|err)` **only when** it exceeds the
threshold (default 1s), so the happy path stays quiet and prod logs pinpoint
which call is slow instead of guessing from generic abort errors. Grep Deno
Deploy logs for `FS-PROFILE` to find the offenders.

Wired in at the **leaf I/O boundaries**, which transitively covers every
higher-level repository/service function (no per-function instrumentation, no
double-logging):

- **Firestore** — all 9 `FirebaseAdminClient` methods in
  [shared/firestore/wrapper.ts](shared/firestore/wrapper.ts)
  (get/set/delete/list/batch/atomicCreate/incrementField/setMerge/
  transactionalUpdate), each labeled with its doc/collection path
  (`firestore.get <path>`).
- **Bland** — `sendSms`, `getConversation`, and the per-page cursor fetch in
  [shared/services/bland/client.ts](shared/services/bland/client.ts).
- **ReadyMode TPI** — the shared `httpGetJson` leaf in
  [shared/services/readymode/tpi-client.ts](shared/services/readymode/tpi-client.ts),
  labeled by URL path (covers all callers incl. `fetchAttemptsFromTpi`).
- **Quickbase** — the per-attempt `fetch` in `queryRecords`/`upsertRecords`
  ([shared/services/quickbase/api.ts](shared/services/quickbase/api.ts)), scoped
  to the network round-trip so the 2s/5s/10s retry backoff is **not** counted
  (see the AbortError gotcha in §0.2).

### 0.18 Nightly report — daily funnel + retime (June 2026)

The daily Postmark report ("the 4:15 email") was reworked to lead with the four
numbers that matter for the prior ET day, and retimed so those numbers are
actually settled when it fires.

- **Yesterday funnel block** in
  [shared/services/report/nightly.ts](shared/services/report/nightly.ts): SMS
  sent → calls scheduled → calls answered → bookings, all read from a single
  `metrics/daily/{yesterday}` doc (one `db.get`, no scans). Mapping: `textsSent`
  → SMS sent, `apptsBooked` → calls scheduled, `answered` → calls answered,
  `activations` → bookings. The existing week-to-date / lifetime table is kept
  below it. Note the four counters use **different event clocks** (sends,
  bookings, calls, sales each bucket by their own day), so a day's `answered`
  can exceed its `scheduled` — the `answered ⊆ booked` invariant only holds
  lifetime.
- **New write-side `answered` counter.** There was no per-day answered counter;
  added one in
  [shared/services/readymode/import-dispositions.ts](shared/services/readymode/import-dispositions.ts),
  mirroring the sale-match activations counter: fire-and-forget **after** the
  batch commit, bucketed by the ET day of the answered call. It applies
  **deltas, not events** — a re-import that surfaces an earlier `answeredAt`
  moves the count between days (+1 new / −1 old) instead of double-counting;
  lifetime only bumps on a first-ever answer. A negative day-delta is written
  through a clamped transactional update (`max(0, …)`) so a re-import moving a
  pre-counter answer can't drive an old day below zero before the backfill seeds
  it. Backfill historical days with `scripts/backfill-daily-answered.ts`
  (recomputes from `guestanswered`; uses `setMerge` so it never clobbers the
  other daily counters, and **skips the current ET day** — that's owned by the
  live forward counter, so overwriting it with a mid-day snapshot would
  transiently undercount). `bucketDay`/`runBackfill` are exported and
  unit-tested
  ([tests/unit/scripts/backfill-daily-answered.test.ts](tests/unit/scripts/backfill-daily-answered.test.ts)).
- **Retimed `15 8 * * *` → `15 10 * * *`** (4:15 → 6:15 AM ET) in `main.ts`, so
  the report fires after `daily-qb-sale-match` (09:00 UTC) and
  `readymode-daily-pull` (09:30 UTC) populate yesterday's bookings + answered.
  The report derives "Yesterday" from its `reportDate` (not the wall clock), so
  an ad-hoc `?date=` back-fill run reports the day before that date and keeps
  the header + funnel block aligned.
- **`?force=1`** on `/api/report/nightly` test-sends past the `enabled`
  kill-switch without stamping `lastSentEtDate`.
- **Log noise:** the every-minute `⏰ sweep: scanned=0 …` no-op line is now
  suppressed (only logs when the sweep did work or errored); the per-minute
  `[cron-tick]` heartbeat is deliberately kept as the liveness signal.

### 0.19 ReadyMode pull reliability + "answered" accuracy (June 2026)

The `readymode-daily-pull` cron had failed intermittently for ~a month (only ~9
of 41 days 05-07→06-16 captured), so the report's "calls answered" silently read
`0` for most days. Two root causes — both fixed + deployed 2026-06-18 (commit
`825bba7` on top of `a7cd709`):

- **Creds** — RM rejected the `AlexA` service account ("Bad account
  information"). Resolved by resetting the password. If it recurs, update
  `RM_PASS` in BOTH `env/local` AND Deno Deploy settings.
- **Single-session lockout** — back-to-back / mid-day logins hit "AlexA is
  already logged in!". Fixed with a reactive takeover in `login()`
  ([portal-client.ts](shared/services/readymode/portal-client.ts)): first POST =
  creds only; on RM's 200 "already logged in" interstitial, re-POST the same
  body + `logout_other_sessions=on` (NEVER on the first POST — that 500s with
  "cURL malformed URL"). Opt-in via `takeoverIfLoggedIn`; the daily cron AND the
  manual/triage pulls both pass it `true` (AlexA is a dedicated bot).
  Unit-tested in
  [readymode-login-takeover.test.ts](tests/unit/services/readymode-login-takeover.test.ts).

- **Report reliability flags.** The report reads the `readymode-daily-pull` and
  `daily-qb-sale-match` cron-health markers and flags "Calls answered" /
  "Bookings" as **⚠ unverified** when the feeding pull didn't run+succeed on the
  report's own ET morning — a missing counter field is "not collected", not a
  measured zero. Exposed as `ydAnsweredReliable`/`ydBookingsReliable` on the API
  JSON + a red banner in the email. Reliability is inferred from the single
  global marker, not verified per-day.

- **What "Calls answered" actually means.** A distinct phone in the
  **Appointments** campaign that had a real conversation, decided by the shared
  `isAnsweredCall` gate (`import-dispositions/mod.ts`, single-sourced so the
  live import + the backfill can't drift):
  - a non-No-Answer disposition lasting **≥ 60s** (`ANSWERED_MIN_SECONDS`), OR
  - a **"No Answer" disposition that nonetheless ran ≥ 180s**
    (`NO_ANSWER_ANSWERED_MIN_SECONDS`, added 2026-06-23) — a No-Answer that long
    is almost always a mis-disposition (the agent held a real conversation and
    fat-fingered the outcome), so we count the CONNECT while preserving the
    agent's disposition string verbatim in `calldispositions`.

  `test` rows never count, and RM logs sub-minute blips ("<30s", "<1m") so
  duration still gates the normal path. `answered ⊆ our-leads`. (Earlier drafts
  rejected ALL "No Answer" rows regardless of length; the ≥180s override
  reverses that for genuinely long calls only.)
  - **Campaign id = `81`** — the call-log REPORT id
    (`APPOINTMENTS_CAMPAIGN_REPORT_ID`). This is NOT the lead-inject channel
    code (`campaigns.ts` `"ODR - Appointments"` → `cuCyA6Xoeu88`). They are
    different ID namespaces: the call_log report's `restrict_campaign` filter
    **silently ignores** the inject code and returns ALL campaigns. The integer
    id lives in the `campaignlist` map of the call_log JSON.
  - **The campaign is small** — ~1–2 answered leads/week, ~74 distinct Feb→Jun;
    lifetime answered ≈ **157** (2026-06-18). NOT thousands.
  - ⚠️ **Correction (2026-06-18).** An earlier draft of this section claimed
    "Appointments IS our entire ODR volume → answered is in the thousands" and
    that 06-16 yielded ~225 answered. BOTH were artifacts of the
    inject-code-vs-report-id bug above: the filter was ignored, so the pull
    returned all ~24 campaigns (~2000 calls/day) and the old disposition-only
    rule mislabeled ~11% as "answered". With the correct id 81 + duration gate,
    06-16 = 0 new answers and the true history added just **4** missed answers.
- **Forward import (fixed 2026-06-18).** `scrapeReadymode` now defaults to
  `restrictCampaign:"81"`, so the daily pull is **~1 page (not 79)** and every
  row is one of our leads. Because the rows are campaign-restricted, the
  injectionhistory funnel gate is dropped
  (`importDailyDispositions(rows,
  {requireInFunnel:false})`); an explicit
  all-campaigns pull (`restrictCampaign:"0"`, e.g. via
  `/api/admin/pull-readymode`) keeps the gate on (`answered ⊆ booked`). Per-row
  duration is captured in `DialerCallRow.durationSecs` (parsed from RM's
  `Calltime`) and, as of 2026-06-23, **persisted on the `calldispositions` doc**
  so the answered rule stays auditable after the fact. Trade-off:
  `calldispositions` is now Appointments-scoped going forward, so the dashboard
  "activated" drill-in shows only Appointments calls for a lead.
- **No-Answer override + backfill (2026-06-23).** Added the **≥180s "No Answer"
  → answered** reclassification (`NO_ANSWER_ANSWERED_MIN_SECONDS`, see the
  "Calls answered" bullet above) plus `durationSecs` persistence. A campaign-81
  re-pull of 05/24→06/23 via `backfill-answered-by-campaign.ts` recovered **1**
  previously-missed answer — a 25-min No-Answer mis-disposition (`8508306131`).
  Skipped the `backfill-daily-answered.ts` counter recompute for a single-phone
  delta, so `metrics/daily.answered` + lifetime trail `guestanswered` by 1 until
  the next recompute.

- **Ops scripts** (run by hand with `--env-file=env/local`, NOT crons):
  - `scripts/triage-readymode.ts` — read-only dump of the cron markers +
    `metrics/daily` (`--days=N` window) + lifetime; `--pull --date=MM/DD/YYYY`
    runs a live pull (surfaces the real error, backfills that day, uses the
    takeover).
  - `scripts/backfill-answered-by-campaign.ts` — hand-walk historical "answered"
    backfill via a campaign-filtered call-log pull. Defaults to campaign
    **`81`** (Appointments, the REPORT id — pass `--campaign` to override) and
    the corrected rule (duration ≥ 60s AND not No-Answer). Writes a real
    `answeredAt` from the call time. **ADDITIVE** into `guestanswered` (only
    adds phones not already present — never overwrites the ~34 manually-verified
    answers). `--from`/`--to`, `--apply` to write. Day-by-day at ≤1 day/min,
    weekends skipped; for campaign 81 each day is ~1 page so the whole history
    is cheap.
  - `scripts/backfill-daily-answered.ts` — recompute `metrics/daily.answered` +
    lifetime from `guestanswered` afterward (zero RM load).

`TODO.md` tracks the phased plan (forward cron fix = done; injected-universe
reconciliation; the answered backfill; the forward-gate widening; a verification
view).

### 0.20 shape-checker adoption — `src/` canonical migration (June 2026; all modules + kernel done, deploy-gated endgame remains)

Migrating the backend into the rune canonical module shape under `src/` so
`deno task shape-check` passes (mirrors the `autobottom` project). Full plan +
rationale: [docs/shape-checker-migration.md](docs/shape-checker-migration.md).
This supersedes the old "shape-checker abandoned / ignore it" note in §0.1.

- **The mechanism.** `shape-checker` discovers its file set from **git
  tracking** (no include/exclude flag). `deno task shape-check` →
  `fixtures/scripts/shape-check.sh` temporarily git-untracks everything that
  isn't `src/` (appends to `.gitignore` + `git rm --cached`), runs the checker
  so it sees ONLY `src/`, and restores git on `trap EXIT`. Invariants: no
  `set -e`; `git add` without `-f` in cleanup; the `HIDE` list is used for both
  untrack + restore (kept in sync). As a module migrates, its old path drops off
  `HIDE`.

- **Canonical shape (learned from the checker).** Module =
  `src/<module>/{entrypoints,domain/business,domain/data}/<feature>/` + a
  top-level `mod-root.ts` (the ONLY allowed barrel). Business feature = `mod.ts`
  - `test.ts`; **data feature (external adapter) = `mod.ts` + `smk.test.ts`**
    (NOT `test.ts`). A normal module needs `mod-root.ts` AND ≥2 layers; **`core`
    is the exempt kernel** (no `mod-root.ts`; importers use full
    `@core/<layer>/<feature>/mod.ts` paths). **Model A confirmed viable**: an
    entrypoint-less module (only `domain/…`) passes — so HTTP stays in Fresh
    routes/`main.ts` as thin adapters; we did NOT rewrite webhooks into a
    router.

- **Incremental + non-breaking via shims.** A module's files are `git mv`'d into
  `src/`; intra-module imports rewritten to `@module/` aliases (in `deno.json`:
  `@core/ @sms-flow/ @dialer/ @messaging/ @crm/ @scheduling/ @reporting/
  @auth/`,
  plus `#assert`); the old `shared/services/*` paths become one-line `export *`
  **re-export shims**. Shims live in the untracked `shared/` tree (never
  shape-checked), so every existing `@shared/...` importer keeps working and the
  app stays deployable at every step. `@shared/*` imports FROM `src/` do not
  violate `import-aliases`, so the firestore kernel can stay in `shared/` for
  now.

- **Gotcha fixed:** `.gitignore` had an unanchored `data/` that ignored EVERY
  `src/<module>/domain/data/` folder; anchored to `/data/` (root credentials dir
  only). `git mv`'d files slipped through but fresh files (smk tests) were
  silently ignored until this fix.

- **Status (2026-06-19).** **All backend logic migrated + green** (scoped
  shape-check 0, `deno check main.ts` clean, ~218 tests): the 8 modules **core,
  sms-flow, crm, messaging, reporting, scheduling, auth, dialer** PLUS the full
  kernel — `firestore/*` → `core/data` (firestore-client/wrapper/paths/txn,
  legacy-key-map), `util/{time,phone}` → `core/business`, `types/*` → `core/dto`
  (flat `<name>.ts`), `config/{constants,env}` → `core/business`. `config`
  folded into `core/business`; `orchestrator` into `sms-flow`
  (orchestrator-store · delayed-injection); `readymode` became the new `dialer`
  module. All intra-core imports use `@core`. `shared/` now holds only 66
  re-export shims + `ui/pages.ts`. Two `.gitignore` anchor fixes: `data/` →
  `/data/` and `env/` → `/env/` (both unanchored patterns were hiding canonical
  `src/` folders). **Remaining = the deploy-gated endgame:** relocate Fresh →
  `frontend/` + flip the Deno Deploy entrypoint (preview-test first; moves
  `ui/pages.ts` too), then delete the shims + rewrite ~157 `@shared` importers
  - co-locate `tests/` so `shared`/`tests` drop from the `HIDE` list. An
    autocheck Stop hook enforces shape-check + tests on every `src/`/`frontend/`
    change (bypass file: `.claude/no-autocheck`).

- **MERGED + LIVE on prod (2026-06-19).** The refactor was validated on a Deno
  Deploy **branch deployment** of `shape-checker-migration` (every external path
  identical to prod; a paranoia audit confirmed the rate-limit/throttle code is
  byte-identical to prod and the ReadyMode guards fail closed), then
  fast-forwarded into `main` and pushed. `main.ts` was byte-identical to prod
  before the merge, so the entrypoint + all 8 `Deno.cron` registrations are
  unchanged — the deploy only moved module files behind the shims. Post-deploy
  prod verification green (`/healthz`, `/login`, auth 401s, `/canary` fail-
  closed, the migrated orchestrator-store read all identical); GitHub reported
  the build `success`. The refactor is **deploy-transparent**: same entrypoint,
  same Fresh `routes/`/`islands/` layout, logic behind `@shared/*` re-export
  shims. **Still pending (the later finale):** relocate Fresh → `frontend/` +
  flip the Deno Deploy entrypoint, then delete the shims + co-locate `tests/` so
  `shared`/`tests` drop from the `HIDE` list.

---

### 0.21 Conversation transcript completeness + booking-path integrity (June 2026)

Auditing the dashboard (appts booked / answered / sales) surfaced two
data-completeness gaps on the **direct-injection** booking paths. The headline
counts are NOT affected (appts come from
`injectionhistory`/`scheduledinjections`, answered from `guestanswered`, sales
from `guestactivated` — none depend on the stored SMS transcript); the gaps are
in the **conversation review view**.

- **Talk-now stores only the signal, not the transcript.**
  `POST /sms-callback/bland/talk-now` injects + writes an `injectionhistory` doc
  (`firedBy:"talk-now"`) but **never calls `storeMessage`**. The "I want to talk
  now" exchange happens inside Bland; we receive only the talk-now webhook (the
  phone), not the messages. Our `conversations` collection gets Bland messages
  only via the per-call webhook `/sms-callback/conversation/[phone]/[callId]`,
  the seed scripts, and the **nightly reseed cron**
  (`reseedConversationsByDateRange`). So a talk-now lead's appointment is
  captured while its transcript may live only in Bland (e.g. `8508306131`:
  appointment Jun 22, conversation in our store ends Mar 28).

- **Cal.com booking failures are fail-safe but only loudly logged.**
  `routes/cal/schedule.ts` defaults
  `bookingUid="CAL_FAILED_BUT_INJECTION_SCHEDULED"`; on a `createBooking` throw
  it logs
  **`[cal/schedule] ⚠️ Cal.com booking
  failed: <reason> — proceeding with SMS injection (fail-safe)`**
  and still schedules the injection (the guest is dialed; only the Cal _calendar
  event_ is missing). The synthetic sentinel callId only surfaces when Bland
  sends no `conversationId`, so searching the conversation store for it
  **undercounts** — the log line is the true signal (but Deploy logs are
  ephemeral). Durable fix (planned): write a `calBookingFailed`/`calError` flag
  on the scheduledinjection so failures are queryable from data, not just logs.

- **Fix — on-booking additive transcript ingestion.** After a successful inject,
  both direct-injection endpoints (`/cal/schedule`,
  `/sms-callback/bland/talk-now`) pull the Bland transcript and store it,
  best-effort (non-blocking). Uses a **purely additive**
  `ingestBlandTranscript(phone10, conversationId?)` (in `messaging` reseed):
  resolve by `getConversation(id)` if the webhook carries a Bland conversation
  id, else `searchConversationsByPhone(phone10)` (phone alone suffices — no
  Bland-side change required); write each message with its Bland `created_at`
  timestamp; **never deletes** (unlike `reseedOne`'s delete-replace, which
  strips nodeTags and would clobber the "appointment scheduled" marker).
  Storage-level duplicates are collapsed at read by `dedupeMessages`
  (`callId__sender__message`, earliest wins), so this is safe. The nightly
  reseed remains the completeness backstop (the on-booking pull may miss the
  final wrap-up message still in flight when the webhook fires).

### 0.22 Correctness hardening sweep — 42 bug fixes (June 2026)

A multi-agent bug-hunt (8 flows × find → adversarially-verify → fix → test, 3
rounds) audited the live pipeline and fixed **42 verified bugs**; unit suite
**193 → 265** (72 new tests), scoped shape-check still 0. All changes sit behind
existing seams — no architecture change. Five themes:

- **Phantom-success on ReadyMode's HTTP-200-but-rejected responses
  (generalized).** The `40a5c8e` verdict fix only covered the main inject; the
  same loose `text.includes("Success") || res.ok` check was silently recording
  rejected leads as injected in `handleDuplicate`, `scrubLead`, and `dncLead`.
  All now use the strict `injectVerdictIsSuccess(isSuccess, explicitlyRejected)`
  helper + `injectBodyExplicitlyRejected` (whose text fallback now also catches
  `"Success":false`, not just `"Accepted":false`). The route handlers
  `return-to-source`, `disposition` (both the ODR-return and recycle branches),
  and `bland/talk-now` now **check `injectLead`'s status before** flipping the
  lead pointer / deleting the pending `scheduledinjection` / writing the
  `injectionhistory` status — a failed RM inject no longer reads as a completed
  move (talk-now leaves the pending marker for the sweep to retry).

- **Atomicity on hot-path read-modify-writes (was check-then-write TOCTOU).**
  Converted to Firestore transactions with reserve/release-on-failure: the
  **global daily SMS cap** + **per-phone rate limiter** are now *reserved
  atomically before* the Bland send and *released* if the send fails (so a
  transient Bland error doesn't lock the phone out for the 30-day window); the
  **A/B variant toggle**, **`setGatesConfig`/`setCronConfig`** (were merging
  against the 60s cache → lost updates), **sale-match activation dedup**, and the
  **nightly-report cron idempotency** (transactional `claimReportDay` CAS on
  `lastSentEtDate` → no double-send on concurrent fires). The injection sweep now
  writes `injectionhistory` and deletes the `scheduledinjection` in **one batch**
  (all-or-nothing). Post-send metadata writes in `processInboundLead` moved into
  their **own** try-catch so a Firestore hiccup *after* a delivered SMS can't flip
  the result to "Bland failed" and trigger an upstream resend.

- **Firestore doc-id collisions (same-millisecond overwrite).** Message +
  injection doc ids built from `phone__callId__timestamp` silently overwrote when
  two writes landed in the same ms. Added a per-message discriminator
  (`conversationDiscriminator`, djb2) to the conversation-webhook + reseed ids, a
  message index to reseed, and a nonce (`injectionDiscriminator`) to talk-now's
  `injectionhistory` id.

- **Webhook status contract change — ⚠️ action for monitoring.** Endpoints that
  previously returned **HTTP 200 even on internal failure** now return **502**
  (failed inject / all-domain DNC failure) or **400** (`/trigger/manual` error):
  `/sms-callback/{disposition,stop,bland/talk-now,return-to-source,conversation/[phone]/[callId]}`
  and `/trigger/manual`. This lets Bland/ReadyMode retry or alert instead of
  silently dropping. The local DNC opt-out (`storeMessage` + `markDnc`) is still
  recorded **before** any 502, so the guest is locally suppressed regardless.

- **Reliability + counting.** Nightly report now demotes
  `ydAnsweredReliable`/`ydBookingsReliable` when a counter increment **silently
  failed** (per-day `answeredCounterFailedAt`/`activationsCounterFailedAt` flags,
  set on failure and **cleared on a later successful** increment) and exposes a
  `wtdComplete` flag when a WTD day's `metrics/daily` doc is missing; `cronFreshFor`
  rejects **future-dated** markers (`> currentEtDay`); RM pagination no longer
  terminates early when the response omits `pages` (defaults to ≥1); booking-scan
  again honors the `appointment scheduled` **nodeTag** signal (it was dropped in
  the message mapping); `normalizeAppointmentTime` **throws** on a
  syntactically-invalid TZ-marked input instead of passing it downstream (where the
  sweep would never fire it); `parseHhMmOr` rejects hours 24–29;
  `guestanswered.lastDisposition` is HTML-entity-decoded to match `calldisposition`.

Method note: the hunt + adversarial verify ran on Haiku, the distill + fixes on
Opus; the loop stopped at the agreed 3-round cap **without converging** (round 3
still surfaced new majors), so a future pass may find more. Partially advances the
TODO "make injection-recording reliable" + "lock with a test" items.

### 0.23 Resilience incident + hardening — ET dates, fail-safe config, DNC compliance (June 29–30 2026)

A live incident: the dashboard showed an empty "tomorrow" after 8 PM ET, and the
Deno Deploy logs carried `[gates-config] read failed, using defaults` on a
transient Firestore DNS blip (`getaddrinfo EAI_AGAIN`). Two root causes, both
fixed; a follow-up adversarial sweep + a code review then hardened the whole
class. Unit suite **265 → 320**. No leads were lost (delayed only).

- **Dates were UTC, not ET.** The dashboard default range + "Send Report" used
  `new Date().toISOString()` (UTC), so after ~8 PM ET they jumped a day ahead and
  showed nothing. Client defaults now format in ET via
  `toLocaleDateString("en-CA", { timeZone: "America/New_York" })`. The sweep also
  killed the whole **DST class**: a new `etDayBoundaryIso(date,"start"|"end")`
  reads the EDT(-04)/EST(-05) offset for the specific date, replacing hardcoded
  `-04:00` boundaries in dashboard drill/stats, appointments, audit-browse, and
  `easternMondayDateString` (all an hour wrong every winter); and
  `defaultDateTimeLocal` switched to `hourCycle:"h23"` (the old `hour12:false`
  could emit hour `24` belonging to the prior day → an off-by-one default near
  ET midnight).
- **A DNS blip was disarming the dialer.** `getGatesConfig()` returned
  `GATES_CONFIG_DEFAULTS` on any read failure, and the default
  `scheduledInjectionSweepEnabled` is `false` — so a transient blip silently
  PAUSED the per-minute injection sweep (delay-not-loss: the gate short-circuits
  before touching `scheduledinjections` docs, so they re-fire on the next healthy
  minute). Fix: gates-config now serves the **last-good cached value** on a read
  failure (safe defaults only on a cold start with no prior read), and the
  Firestore wrapper **retries idempotent reads** (`get`/`list`) on transient
  errors (`withTransientRetry`/`isTransientFirestoreError`). The sweep's per-phone
  `batch()` was also moved INSIDE the per-phone try-catch (a transient batch
  failure had aborted the whole sweep and stranded later due phones).
- **Observability honesty.** `CronRunMarker.lastStatus` gained `"skipped"` +
  `skipReason`; `recordCronRun` hands the wrapped fn a `markSkipped(reason)`
  context. A paused sweep (incl. a blip-induced disarm) and the 4 nightly-report
  skip paths now record `"skipped"` on `/api/admin/cron-health` instead of a
  misleading green `"ok"`.
- **[DECISION] DNC fails CLOSED (compliance).** `isDnc()` now returns `true`
  (treat as opted-out) on a read failure rather than fail-open — contacting a
  DNC/TCPA opt-out is a violation, so when we can't confirm we must NOT contact
  (a sustained outage conservatively skips a few recoverable texts; the wrapper
  retry makes that rare). It bumps a best-effort `dncReadFailures` daily counter.
  `markDnc()` now retries the idempotent write and RETURNS whether it landed;
  `/sms-callback/stop` + the conversation webhook return 502 on a failed local
  mark so ReadyMode/Bland retries rather than silently dropping the opt-out.
- **Tidy-ups (from the review):** the clear-on-success / stamp-on-failure
  `*CounterFailedAt` logic in lead-service, inj-schedule, and sale-match is now
  one `withCounterFailureFlag(client, docPaths, field, fn)` helper (the null/ISO
  contract nightly reads lives in one place).
- **Product intent docs recovered.** `spec/product/spec.md` +
  `user-stories.md` reverse-engineered from the shipped app (16 capability areas,
  74 stories, 12 `[DECISION]`s) for the Shepherd User Stories tab. `spec` is in
  the shape-check `HIDE` list and `spec/product/` is excluded from `deno fmt`
  (fmt line-wraps the one-line-per-story format the parser needs).

---

## 1. Project goals

- **Single Deno Deploy app** at `~/Programming/sms-bot/` serving every endpoint
  that the three legacy systems served.
- **Firestore-backed** (replacing the existing Deno KV deploy at
  `google-sheets-kv.thetechgoose.deno.net`). All writes go to a single root
  collection `sms-bot`. Service account is already provisioned by the user.
- **One-time historical migration** from existing Deno KV → Firestore via
  [scripts/migrate-kv-to-firestore.ts](scripts/migrate-kv-to-firestore.ts).
- **New "sale match" flow:** a daily cron-fired endpoint pulls a Quickbase
  report of phones booked today and marks each as a sale (within a
  7-day-from-appointment window) for productivity reporting.
- `Deno.test` coverage as we go; `shape-checker` (run from the project root) to
  keep file structure sane.

---

## 2. Repo layout (target)

```
sms-bot/
├── context.md                       ← this file
├── main.ts                          ← user provides (legacy playground reference)
├── deno.json                        ← TODO: create (imports map + tasks)
├── deno.lock                        ← TODO: generate via `deno cache`
├── src/
│   ├── server.ts                    ← TODO: Deno.serve entry point + router
│   ├── config/                      ← TODO: env loading, domain configs
│   ├── firestore/                   ← TODO: Firestore client wrapper
│   ├── routes/                      ← TODO: HTTP handlers (split by feature)
│   │   ├── trigger/                 ← /trigger/readymode, /trigger/manual
│   │   ├── callback/                ← /sms-callback/* (bland, appt, disposition, stop, return-to-source)
│   │   ├── orchestrator/            ← /sms-flow/orchestrator/* (read-only state)
│   │   ├── queue/                   ← /sms-flow/queue/trigger
│   │   ├── dashboard/               ← UI HTML + /api/dashboard/* + /api/appointments
│   │   ├── search/                  ← /search UI + /api/conversations/search{,2}
│   │   ├── audit/                   ← /audit UI + /api/audit/*
│   │   ├── injections/              ← /injections UI + /api/injection/{schedule,cancel}
│   │   ├── review/                  ← /review UI + drill-ins
│   │   ├── guests/                  ← /api/guests/{activate,activate-from-report,answered}
│   │   ├── sales/                   ← /api/sales/record
│   │   ├── report/                  ← /api/report/nightly
│   │   ├── cron/                    ← /api/cron/{trigger,trigger-single}
│   │   ├── sms-count/               ← /api/sms/count
│   │   └── kv/                      ← /api/kv/{get,set,list,delete}  (kept for compat/admin)
│   ├── services/
│   │   ├── bland/                   ← Bland.ai SMS client
│   │   ├── readymode/               ← per-domain inject/scrub/DNC
│   │   ├── quickbase/               ← user-supplied client (see §8)
│   │   ├── postmark/                ← nightly report email
│   │   ├── crm/                     ← reservation lookup
│   │   ├── ab-test/                 ← A/B variant toggle
│   │   ├── rate-limiter/            ← per-phone 30-day gate
│   │   └── orchestrator/            ← lead pointer + event log
│   ├── types/                       ← shared DTOs/interfaces
│   └── ui/                          ← HTML templates + shared CSS
├── tests/                           ← TODO: Deno.test files mirroring src/
├── scripts/
│   └── migrate-kv-to-firestore.ts   ← one-shot historical data migration
└── _source-omnisource/              ← read-only reference dump (you'll move/delete this once ported)
    └── sms-flow/                    ← copied from omnisource/backend/apps/confirmations/sms-flow/
```

---

## 3. Architecture

**Process:** single Deno Deploy isolate. `Deno.serve` + a path-based router. No
NestJS — the omnisource `@nestjs/common` decorators are stripped during port;
constructors become factory functions, classes become objects of methods.

**Storage:** Firestore (not Deno KV). Single root collection `sms-bot`. The
legacy code uses HTTP-fronted Deno KV; we replace
`SmsFlowStateService.request(...)` with direct Firestore SDK calls via a thin
wrapper that exposes `get/set/delete/list(prefix)` so the playground's existing
route handlers can be ported with minimal changes.

**Cron:** the daily external cron site continues to exist outside this project.
It POSTs to `/api/guests/activate-from-report` (see §6). Inside the app, the
playground's `/api/cron/trigger` endpoint also remains for processing scheduled
SMS injections — it can be triggered by Deno Deploy's built-in cron or the same
external cron site.

**Outbound calls:** Bland.ai (SMS), Postmark (email), Quickbase (reads),
ReadyMode (5 dialer subdomains, lead inject/scrub/DNC), and the two ngrok
tunnels for `talk-now` callbacks (`conf-deploy.ngrok.app` prod,
`conf-omnisource.ngrok.app` test).

---

## 4. End-to-end flows

### 4.1 Inbound lead → first SMS sent

1. ReadyMode dialer POSTs `POST /trigger/readymode` (or test path
   `POST /trigger/manual` with `?override=true`).
2. Gatekeepers (skipped if `override=true`):
   - attempts ≥ 40
   - global daily SMS count < 100 (Eastern Time)
   - DNC check (Quickbase + KV opt-out flag)
   - 30-day rate limit (per phone)
3. CRM enrichment via Quickbase magic-mirror (lookup by ResID).
4. A/B variant toggle (Firestore-backed).
5. Conversation history fetched.
6. SMS send via Bland.ai (pathway `d6bd66a2-13b4-4365-a994-842c705e22b1`, agent
   `+18435488335`, `pathway_version: "production"`).
7. Persist SMS flow context, lead pointer, orchestrator event.
8. Response: `{status: "success", variant: "A"|"B"}`.

### 4.2 Guest replies → conversation continues

Bland.ai webhooks externally; the conversation messages get stored under
`sms-bot/conversations/messages/{...}` keyed by phone10 + callId + timestamp.
The playground's `/search` UI + `/api/conversations/search2` query this.

### 4.3 Guest opts in → Cal.com sends invite → appointment booked

1. Cal.com (or Bland flow) POSTs `POST /sms-callback/appointment-booked` with
   `{phone, event_time}`.
2. Scrub the lead from its current ReadyMode source domain (read pointer →
   ReadyMode TPI scrub).
3. Save `sms-bot/scheduledinjections/byPhone/{phone10}` =
   `{phone, eventTime, scheduledAt, isTest}`.
4. The Deno Deploy cron (or external cron) hits `GET /api/cron/trigger`
   periodically. That handler iterates `scheduledinjections/byPhone/*`, finds
   entries whose `eventTime <= now`, POSTs to the appropriate `talk-now` ngrok
   URL, writes a `injectionhistory` record, and deletes the scheduled-injection
   doc.

### 4.4 Call ends → disposition handled

1. Dialer POSTs `POST /sms-callback/disposition` with
   `{phone, disposition, campaign_name?}`.
2. If disposition is `sale`/`booked`: do nothing (lead exits funnel).
3. Else if currently in ODR (or ODR-mapped campaign): scrub from ODR, return to
   original source domain.
4. Else: standard recycle — scrub source, inject into recycle target if mapped.

### 4.5 Guest opts out → STOP

1. POST `/sms-callback/stop` with `{phone}`.
2. Mark DNC in Quickbase + Firestore opt-out flag (`doNotText: true` on
   conversation entries / a dedicated `dnc/byPhone/{phone10}` doc).

### 4.6 Daily sale match (NEW)

1. External cron POSTs `POST /api/guests/activate-from-report` with empty body
   once per day.
2. Server fetches the bookings report from Quickbase:
   `POST https://us-central1-crm-sdk.cloudfunctions.net/getReports` body
   `{test: <env QUICKBASE_REPORT_TOKEN>, tableID: "bpb28qsnn", reportID: "530"}`.
3. Response shape:
   `{data: [{"48": {value: "(XXX) XXX-XXXX"}, "-1": {value: "YYYY-MM-DD"}, "-100": {value: "7 Days"}, "-101": {value: "Active Date Legs"}}, ...]}`.
   Field `48` is the phone (formatted, normalize to 10 digits).
4. For each phone10:
   - Look up `sms-bot/scheduledinjections/byPhone/{phone10}`.
   - If present and `eventTime` was within the last 7 days, write
     `sms-bot/saleswithin7d/byPhone/{phone10}` with
     `{phone10, phone11, appointmentAt, saleAt, windowDays: 7, withinDays, updatedAt}`.
   - Also write `sms-bot/guestactivated/byPhone/{phone10}` with
     `{phone10, Activated: true, activatedAt, eventTime}` for dashboard parity.
5. Return summary: `{processed, matched, skipped}`.

This is the same logic as `/api/sales/record` in the playground, just batched
and self-driven.

---

## 5. Endpoint inventory (consolidated app)

| Method     | Path                                    | Source     | Purpose                                                |
| ---------- | --------------------------------------- | ---------- | ------------------------------------------------------ |
| GET        | `/`                                     | playground | Landing page (HTML)                                    |
| GET        | `/dashboard`                            | playground | Analytics dashboard (HTML)                             |
| GET        | `/search`                               | playground | Conversation search UI (HTML)                          |
| GET        | `/audit`                                | playground | Audit record search (HTML)                             |
| GET        | `/injections`                           | playground | Scheduled injections UI (HTML)                         |
| GET        | `/review`                               | playground | Daily response review UI (HTML)                        |
| GET        | `/api/dashboard/stats`                  | playground | Aggregate counts                                       |
| GET        | `/api/dashboard/drill`                  | playground | Drill-in for stat cards                                |
| GET        | `/api/appointments`                     | playground | Appointment-tagged conversations (paged)               |
| GET        | `/api/conversations/search`             | playground | Legacy by-phone search                                 |
| GET        | `/api/conversations/search2`            | playground | Filtered by-phone search                               |
| GET        | `/api/audit/browse`                     | playground | Paged audit records                                    |
| GET        | `/api/audit/check`                      | playground | Single record dedupe check                             |
| GET        | `/api/audit/status`                     | playground | Multi-stage status                                     |
| POST       | `/api/audit/save`                       | playground | Write audit marker (claim/override)                    |
| GET / POST | `/` (with `?recordId=` or POST body)    | playground | LEGACY audit root — keep for callers                   |
| GET        | `/api/state`                            | playground | Read `config/settings/state` doc                       |
| GET        | `/api/kv/get`                           | playground | Admin: raw doc read                                    |
| POST       | `/api/kv/set`                           | playground | Admin: raw doc write                                   |
| DELETE     | `/api/kv/delete`                        | playground | Admin: raw doc delete                                  |
| POST       | `/api/kv/list`                          | playground | Admin: prefix listing (now: subcollection list)        |
| POST       | `/api/injection/schedule`               | playground | Schedule a future SMS injection                        |
| DELETE     | `/api/injection/cancel`                 | playground | Cancel a scheduled injection                           |
| GET / POST | `/api/cron/trigger`                     | playground | Process all scheduled injections whose eventTime ≤ now |
| GET        | `/api/cron/trigger-single`              | playground | Force-fire one injection by phone                      |
| POST       | `/api/sales/record`                     | playground | Manual single-phone sale match                         |
| POST       | `/api/guests/activate`                  | playground | Bulk SHA-256 phone activation (existing flow)          |
| POST       | `/api/guests/activate-from-report`      | **NEW**    | Daily cron entry: pull QB report → match → mark sales  |
| POST       | `/api/guests/answered`                  | playground | Mark guest answered the call                           |
| POST       | `/api/sms/count`                        | playground | Today's SMS count (token-gated)                        |
| GET / POST | `/api/report/nightly`                   | playground | Send Postmark email with stats + CSV                   |
| POST       | `/trigger/readymode`                    | omnisource | ReadyMode dialer webhook → SMS send                    |
| POST       | `/trigger/manual`                       | omnisource | Test override (skips all gatekeepers)                  |
| POST       | `/sms-callback/bland-talk-now`          | omnisource | Hot-path: scrub source → inject ODR                    |
| POST       | `/sms-callback/appointment-booked`      | omnisource | Cal.com booked → schedule future injection             |
| POST       | `/sms-callback/disposition`             | omnisource | Post-call disposition handling                         |
| POST       | `/sms-callback/stop`                    | omnisource | STOP → DNC                                             |
| POST       | `/sms-callback/return-to-source`        | omnisource | Return lead to original source domain                  |
| POST       | `/sms-flow/queue/trigger`               | omnisource | KV cron fires when scheduled time reached              |
| GET        | `/sms-flow/orchestrator/pointer/:phone` | omnisource | Read lead's current location state                     |
| GET        | `/sms-flow/orchestrator/events/:phone`  | omnisource | Read lead's audit trail                                |

> The omnisource ngrok tunnels (`conf-deploy.ngrok.app/confirmations/v001/...`
> etc.) currently route to the legacy app. Once the new app is deployed, those
> ngrok tunnels need to be repointed to the new Deno Deploy URL.

---

## 6. Firestore schema

Single root collection: **`sms-bot`**. Beneath it, one document per data
category, each holding a subcollection (or further docs) with the actual
records. This keeps the project's data fully isolated under one collection name
as required.

```
sms-bot (collection)
├── conversations (doc, container)
│   └── messages (subcollection)
│       └── {phone10}__{callId}__{timestamp}     ← deterministic ID
│              { phoneNumber, callId, sender: "Guest"|"AI Bot",
│                message, nodeTag?, timestamp, doNotText? }
│
├── scheduledinjections (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { phone, eventTime, scheduledAt, isTest, calendlyInviteeUri? }
│
├── smsflowcontext (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { domain, campaignId, reservationId?, phone, leadId?,
│                destination?, firstName?, lastName?, timestamp, ... }
│
├── guestactivated (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { phone10, Activated: true, activatedAt, eventTime }
│
├── guestanswered (doc)                           ← one doc per phone whose
│   └── byPhone (subcollection)                     dialer call connected.
│       └── {phone10}                               answeredAt also drives
│              { phone10, answered: true,           metrics/daily.answered.
│                answeredAt, source?, lastDisposition? }
│
├── audit (doc)                                   ← legacy "global" audit keys
│   └── byRecordId (subcollection)
│       └── {recordId}
│              { processedAt, source, stage?, meta? }
│
├── auditstage (doc)
│   └── {stage}        (subcollection — e.g. "landing", "live")
│       └── {recordId}
│              { processedAt, source, stage, meta? }
│
├── saleswithin7d (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { phone10, phone11, appointmentAt, saleAt,
│                windowDays: 7, withinDays, updatedAt, meta? }
│
├── injectionhistory (doc)
│   └── byPhone (subcollection)
│       └── {phone10}__{firedAt}
│              { phone, eventTime, scheduledAt, isTest, firedAt,
│                firedBy: "cron"|"manual", status, callbackStatus }
│
├── leadpointer (doc)                             ← orchestrator lead state
│   └── byPhone (subcollection)
│       └── {phone10}
│              { domain, campaignId, status, updatedAt, ... }
│
├── orchestratorevents (doc)
│   └── byPhone (subcollection)
│       └── {phone10}__{eventTimestamp}
│              { type: "INJECT"|"SCRUB"|"DNC"|..., domain, campaignId, at, ... }
│
├── ratelimit (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { lastSentAt, count }
│
├── globalsmscount (doc)
│   └── byDate (subcollection)
│       └── {YYYY-MM-DD}
│              { count, updatedAt }
│
├── uniquerecipientbyphone (doc)                  ← write-side index for
│   └── byPhone (subcollection)                     report's lifetime
│       └── {phone10}                               unique-recipient count
│              { phone, firstSentAt }
│
├── weeklyrecipientbyphoneweek (doc)              ← write-side index for
│   └── byKey (subcollection)                       report's WTD unique-
│       └── {weekKey}__{phone10}                    recipient count.
│              { phone, weekKey, firstSentAt }      weekKey = ET Monday
│                                                   ISO date (YYYY-MM-DD).
│
├── injectedphones (doc)                          ← write-side marker per
│   └── byPhone (subcollection)                     phone we've ever
│       └── {phone10}                               scheduled an injection
│              { phone, firstInjectedAt,            for. Collapses
│                lastInjectedAt }                   /api/guests/answered to
│                                                   a single doc.get.
│
├── uniqueguestsbyphone (doc)                     ← dashboard "Unique
│   └── byPhone (subcollection)                     Guests Reached"
│       └── {phone10}                               aggregator. Updated
│              { phoneNumber, firstSeen, lastSeen,  transactionally inside
│                messageCount, replyCount,          storeMessage. /api/guests/
│                hasReplied, updatedAt }            list reads only this.
│
├── metrics (doc)                                 ← daily + lifetime
│   ├── daily (subcollection)                       counters for the
│   │   └── {YYYY-MM-DD}                            morning report.
│   │          { apptsBooked, activations,          Incremented at every
│   │            answered, textsSent, updatedAt }   write site (atomic
│   └── lifetime (subcollection)                    FieldValue.increment).
│       └── totals                                  Report reads, never
│              { apptsBooked, activations,          scans. `answered` is
│                answered, textsSent, updatedAt }   bucketed by the ET day
│                                                   of the answered call
│                                                   (readymode-daily-pull);
│                                                   the others by their own
│                                                   write site's day.
│
├── abtest (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { variant: "A"|"B", assignedAt }
│
└── config (doc)
    └── settings (subcollection)
        └── state
              { partnerStoreRedFlag, ... }
```

**Firestore composite indexes** — defined in
[firestore.indexes.json](firestore.indexes.json), deployed via
`firebase deploy --only firestore:indexes`:

- `messages` collection group — `(phoneNumber asc, timestamp desc)`,
  `(sender asc, timestamp desc)`, `(nodeTag asc, timestamp desc)` — powers the
  database-side filters in
  [routes/api/dashboard/drill.ts](routes/api/dashboard/drill.ts) and the nodeTag
  query in
  [routes/api/admin/repopulate-injections.ts](routes/api/admin/repopulate-injections.ts)
- `byPhone` collection group — `(phone asc, firedAt desc)` — powers per-phone
  history paging in [routes/api/appointments.ts](routes/api/appointments.ts)

Single-field auto-indexes cover the rest:

- `scheduledinjections/byPhone` — `eventTime` (sweep filter)
- `conversations/messages` — `callId` (dedupe + reseed lookup)
- `injectionhistory/byPhone` — `phone`, `recoveredFromCallId`, `firedAt`
- `orchestratorevents/byPhone` — `phone`
- `weeklyrecipientbyphoneweek/byKey` — `weekKey`
- `uniqueguestsbyphone/byPhone` — `lastSeen`, `messageCount`
- `audit/byRecordId` + `auditstage/{stage}` — `processedAt`

---

## 7. KV → Firestore migration

### Prerequisites

- Service account JSON for the user's GCP project (already exists).
- Firestore in **Native mode** (not Datastore mode) on that project. If not
  enabled yet:
  - GCP Console → Firestore → Create database → "Native mode" → choose region.
- Deno installed locally.

### Run the migration

```bash
cd ~/Programming/sms-bot

GOOGLE_APPLICATION_CREDENTIALS=/path/to/service-account.json \
FIREBASE_PROJECT_ID=your-gcp-project-id \
SOURCE_KV_URL=https://google-sheets-kv.thetechgoose.deno.net \
deno run -A scripts/migrate-kv-to-firestore.ts --dry-run
```

Once the dry-run output looks right, drop `--dry-run`:

```bash
deno run -A scripts/migrate-kv-to-firestore.ts
```

To migrate one prefix at a time (recommended for the large `conversations`
prefix):

```bash
deno run -A scripts/migrate-kv-to-firestore.ts --prefix=conversations --limit=50000
```

### What the script does

- Iterates each known KV prefix (`conversations`, `scheduledinjection`,
  `smsflowcontext`, `guestactivated`, `guestanswered`, `audit`, `auditstage`,
  `saleswithin7d`, `injectionhistory`, `config`).
- Calls `POST {SOURCE_KV_URL}/api/kv/list` with `{prefix: [<name>], limit: <n>}`
  to enumerate every entry.
- Transforms each KV key → Firestore doc path per the schema in §6, preserves
  `value`, and stores the original KV key in a `_kvKey` field on each doc for
  traceability.
- Writes via Firestore batch (max 400 ops per batch).

### Caveats

- The legacy `/api/kv/list` endpoint does **not** support cursor pagination — it
  just returns up to `limit` entries in one shot. For prefixes larger than ~10k
  entries, either:
  - Bump `--limit` to a high number and trust the request to complete, or
  - Add cursor support to the legacy endpoint before running.
- The script is idempotent for fixed-key prefixes (re-running overwrites the
  same doc). For `conversations` and `injectionhistory` (which use composed
  deterministic IDs), reruns also overwrite.

---

## 8. Quickbase requirements

You'll wire up the Quickbase service yourself using context from your other
project. The new sms-bot app needs the following operations to exist on whatever
client you provide. List shows: **operation → input → expected output → why it's
needed**.

| Operation                       | Input                                 | Output                                                 | Used by                                                                              |
| ------------------------------- | ------------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `getReport(tableID, reportID)`  | `tableID: string`, `reportID: string` | `{data: Array<{[fid: string                            | number]: {value: any}}>, fields: [...], metadata: {...}}`                            |
| `findReservationByResID(resId)` | `resId: string`                       | `{phone, firstName, lastName, email?, ... }` or `null` | CRM enrichment during inbound lead processing (porting from omnisource `crm/mod.ts`) |
| `markDNC(phone)`                | `phone: string` (10-digit)            | `{success: boolean}`                                   | STOP/opt-out handling (`/sms-callback/stop`)                                         |
| `isDNC(phone)`                  | `phone: string`                       | `boolean`                                              | Gatekeeper before sending SMS                                                        |

**Auth model:** The known `getReports` endpoint is the public Cloud Function
`https://us-central1-crm-sdk.cloudfunctions.net/getReports` and is gated by the
`test` body field acting as a shared-secret token. Other operations may need a
Quickbase user token / app token / temporary auth token — your existing project
will tell us what's needed. Document the auth pattern here once known:

- Env var name(s): `QUICKBASE_REPORT_TOKEN` (the `test` field for `getReports`);
  `QUICKBASE_USER_TOKEN` (likely needed for direct table writes/reads); other?
- Scopes/permissions required:
- Realm/host (e.g. `monsterrg.quickbase.com`):

**Reference response shape for
`getReport(tableID="bpb28qsnn", reportID="530")`:**

```json
{
  "data": [
    {
      "48": { "value": "(936) 676-2277" },
      "-1": { "value": "2026-04-20" },
      "-100": { "value": "7 Days" },
      "-101": { "value": "Active Date Legs" }
    }
  ],
  "fields": [
    { "id": 48, "label": "Reservation - Phone Number", "type": "phone" },
    { "id": -1, "label": "Added", "type": "date" },
    { "id": -100, "label": "Expiry Date", "type": "text" },
    { "id": -101, "label": "Reason", "type": "text" }
  ],
  "metadata": {
    "numFields": 4,
    "numRecords": 110,
    "totalRecords": 110,
    "skip": 0
  }
}
```

The phone in field `48` is formatted `(XXX) XXX-XXXX` — normalize to 10 digits
before lookup.

---

## 9. Bland.ai requirements

- **API base:** `https://api.bland.ai/v1/sms/conversations`
- **Auth:** `Authorization: <api_key>` header (no `Bearer` prefix in legacy code
  — verify against Bland docs).
- **Pathway ID:** `d6bd66a2-13b4-4365-a994-842c705e22b1` (overrideable via
  `BLAND_SMS_PATHWAY_ID` env var).
- **Pathway version:** `production` (currently hardcoded; consider
  env-toggling).
- **Agent number:** `+18435488335`.
- **Inbound webhook target:** Bland.ai is configured to POST to the `talk-now`
  ngrok tunnel; once the new app is deployed, repoint that webhook to the new
  public URL.
- Operations to port from omnisource: create conversation, list today's
  conversations, fetch/seed conversation messages, trigger talk-now.
- Env vars: `BLAND_API_KEY`, `NU_BLAND_API_KEY` (legacy fallback),
  `BLAND_SMS_PATHWAY_ID` (optional override).

---

## 10. Postmark requirements

- **Library:** `npm:postmark` (`ServerClient`).
- **From:** `notifications@monsterrg.com`.
- **To (default):** `adamp@monsterrg.com`.
- **Used by:** `/api/report/nightly` (HTML email with stats table +
  conversations CSV attached).
- Env var: `POSTMARK_SERVER` (Postmark server token).

---

## 11. ReadyMode requirements

5 dialer subdomains, each with its own `lead-api` slug for lead injection (3
of 5) and a `TPI/lead` scrub endpoint (all 5). Defined in
`_source-omnisource/sms-flow/readymode/config/mod.ts`.

| Domain key | Host                               | Lead-API slug  | Has injection? |
| ---------- | ---------------------------------- | -------------- | -------------- |
| `MONSTER`  | `https://monsterrg.readymode.com`  | `8qhAtb6vnrxb` | ✅             |
| `ODS`      | `https://monsterods.readymode.com` | `s2fyaY95pAC2` | ✅             |
| `ODR`      | `https://monsterodr.readymode.com` | `wCoocn6CrCZc` | ✅             |
| `ACT`      | `https://monsteract.readymode.com` | —              | ❌ scrub only  |
| `DS`       | `https://monsterrd2.readymode.com` | —              | ❌ scrub only  |

**Auth:** Basic auth with `RM_USER`/`RM_PASS` (or per-domain
`RM_{DOMAIN}_USER`/`RM_{DOMAIN}_PASS`). Legacy code defaults to hardcoded
`adam`/`Winter123` if env vars are missing — replace defaults with explicit env
vars in the new app and fail fast if missing.

**Operations:**

- `injectLead(domain, params)` → `POST {host}/lead-api/{slug}`
- `scrubLead(domain, phone)` → `POST {host}/TPI/lead` with scrub flag
- `markDNC(domain, phone)` → `POST {host}/TPI/DNC`

Field mappings live in `_source-omnisource/sms-flow/readymode/mapping/mod.ts`
(normalize inbound webhook → standardLead, then denormalize standardLead →
per-domain payload).

---

## 12. Cal.com integration

Cal.com is the booking layer. The relevant touchpoint is
`POST /sms-callback/appointment-booked` — Cal.com (or whatever sits in front of
Cal.com) hits that endpoint when a guest books, with `{phone, event_time}`. The
new app:

1. Resolves the lead's current source domain via
   `leadpointer/byPhone/{phone10}`.
2. Scrubs from that domain.
3. Writes `scheduledinjections/byPhone/{phone10}` with `eventTime: event_time`.

No outbound Cal.com API calls are needed in this consolidation — Cal.com pushes
to us, we don't pull. If/when that changes, document the API key and endpoint
here.

---

## 13. Env vars (full list)

| Name                                                                                                           | Purpose                                                                                                                | Required                |
| -------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------- |
| `FIREBASE_PROJECT_ID`                                                                                          | GCP project hosting the Firestore DB                                                                                   | ✅                      |
| `GOOGLE_APPLICATION_CREDENTIALS` (local) **or** `FIREBASE_SERVICE_ACCOUNT_JSON` (Deno Deploy, raw JSON string) | Service account auth                                                                                                   | ✅                      |
| `BLAND_API_KEY`                                                                                                | Bland.ai SMS auth                                                                                                      | ✅                      |
| `NU_BLAND_API_KEY`                                                                                             | Bland.ai legacy fallback                                                                                               | optional                |
| `BLAND_SMS_PATHWAY_ID`                                                                                         | Override default pathway                                                                                               | optional                |
| `POSTMARK_SERVER`                                                                                              | Postmark server token                                                                                                  | ✅ (for nightly report) |
| `QUICKBASE_REPORT_TOKEN`                                                                                       | The `test` body field for the `getReports` Cloud Function                                                              | ✅                      |
| `QUICKBASE_USER_TOKEN`                                                                                         | Quickbase API user token (if direct API access is needed)                                                              | TBD                     |
| `QUICKBASE_REALM`                                                                                              | Quickbase realm host (e.g. `monsterrg.quickbase.com`)                                                                  | TBD                     |
| `RM_USER` / `RM_PASS`                                                                                          | ReadyMode default Basic auth                                                                                           | ✅                      |
| `RM_MONSTER_USER` / `RM_MONSTER_PASS`                                                                          | Per-domain override                                                                                                    | optional                |
| `RM_ODS_USER` / `RM_ODS_PASS`                                                                                  | Per-domain override                                                                                                    | optional                |
| `RM_ODR_USER` / `RM_ODR_PASS`                                                                                  | Per-domain override                                                                                                    | optional                |
| `RM_ACT_USER` / `RM_ACT_PASS`                                                                                  | Per-domain override                                                                                                    | optional                |
| `RM_DS_USER` / `RM_DS_PASS`                                                                                    | Per-domain override                                                                                                    | optional                |
| `KV_SERVICE_URL`                                                                                               | NOT used by new app — only the migration script uses it (renamed `SOURCE_KV_URL`)                                      | n/a                     |
| `CRON_SHARED_SECRET`                                                                                           | Shared secret the external cron site sends in a header so `/api/guests/activate-from-report` can reject random callers | recommended             |
| `SMS_COUNT_TOKEN`                                                                                              | The `test` body field for `/api/sms/count` (currently hardcoded base64 in playground — extract to env)                 | recommended             |

---

## 14. Daily cron contract

External cron site (already exists) hits the new app once per day with:

```
POST /api/guests/activate-from-report
Content-Type: application/json
X-Cron-Secret: <CRON_SHARED_SECRET>
(empty body)
```

Server fetches the Quickbase report itself (see §8), processes matches, returns:

```json
{
  "success": true,
  "fetchedFromReport": 110,
  "matched": 14,
  "skippedNoInjection": 90,
  "skippedOlderThan7Days": 6,
  "matches": [{ "phone10": "9366762277", "appointmentAt": "...", "withinDays": 3 }, ...]
}
```

The legacy `/api/cron/trigger` endpoint also stays — it may be triggered by a
separate cron or by Deno Deploy's built-in cron API to process scheduled SMS
injections every minute.

---

## 15. Gotchas (from omnisource)

- **No injection lock.** A previous lock mechanism caused triple-injections; it
  was removed in favor of a preemptive scrub. Don't reintroduce a lock without
  testing.
- **Conversation lookup race.** The `lookup_call_id → phone` secondary index
  must be written _before_ messages are stored or `getConversationByCallId` will
  fail. Backfill endpoint exists in legacy code (callback/mod.ts:735); port it.
- **`?override=true` skips everything.** All gatekeepers (attempts, daily cap,
  DNC, rate limit) bypassed. Used only by `/trigger/manual`.
- **Global daily SMS cap = 100, hardcoded, Eastern Time.** Lives at one shared
  counter, not per-domain.
- **Hardcoded ReadyMode credentials.** Legacy defaults to `adam`/`Winter123` if
  env vars missing. New app should fail fast instead.
- **`pathway_version: "production"` is hardcoded.** No env toggle in legacy;
  consider adding one.
- **Quickbase magic-mirror returns array-like, not Promise.** Legacy code does
  `.sortByDateModified("desc")[0]` — verify behavior when porting.
- **Conversation seeding has built-in delays.** 100ms between messages, 300ms
  between conversation IDs, to avoid overwhelming remote KV. With Firestore
  batched writes this is no longer needed, but verify Bland API rate limits
  separately.
- **Talk-now scrub is optional.** Proceeds even if no source domain is on the
  lead pointer.
- **Ngrok tunnel aliases.**
  `conf-deploy.ngrok.app/confirmations/v001/sms-callback/bland-talk-now` (prod)
  and `conf-omnisource.ngrok.app/confirmations/v001/sms-callback/bland-talk-now`
  (test) currently route to the legacy app. After deploy, either repoint the
  tunnels at the new Deno Deploy URL **or** mount the new handlers under
  `/confirmations/v001/...` so the existing tunnels keep working without
  changes.
- **Phone-number format inconsistencies.** Inbound from Quickbase report =
  `(XXX) XXX-XXXX`; Bland = E.164; ReadyMode = digits only; KV keys = 10 digits.
  Always normalize at the edge.

---

## 16. Build plan (step by step)

### Phase 0 — bootstrap (1 hour)

1. `cd ~/Programming/sms-bot`
2. Drop your saved playground `main.ts` at the repo root as a reference (don't
   import from it).
3. Create `deno.json` with import map for `npm:postmark`, `npm:firebase-admin`,
   and tasks for `dev`, `test`, `migrate`, `shape-check`.
4. Create `src/server.ts` with a minimal `Deno.serve` that 200s `GET /healthz`.
   Verify locally: `deno task dev`.
5. Set env vars locally via a `.env` file (gitignored) + a `.env.example` that
   lists every variable from §13.

### Phase 1 — Firestore wrapper + migration dry-run (2-3 hours)

6. Create `src/firestore/client.ts`: thin wrapper exposing `get(path)`,
   `set(path, data)`, `delete(path)`, and `list(parentPath, opts)` over
   `npm:firebase-admin/firestore`.
7. Add `src/firestore/keys.ts` with helpers like
   `conversationDocPath(phone10, callId, ts)` and
   `scheduledInjectionPath(phone10)` mirroring §6.
8. Run the migration script in dry-run against a tiny prefix:
   `deno run -A scripts/migrate-kv-to-firestore.ts --dry-run --prefix=config`.
   Check the path/data output.
9. Real run for small prefixes (`config`, `saleswithin7d`, `injectionhistory`).
10. Real run for `conversations` + `scheduledinjection` (the large ones) — bump
    `--limit` if needed.

### Phase 2 — port the playground UI/API surface (1-2 days)

11. Move HTML strings (`homePageHtml`, `dashboardHtml`, `auditSearchHtml`,
    `searchPageHtml`, `injectionsPageHtml`, `reviewPageHtml`, `sharedThemeCss`)
    into `src/ui/*.ts`.
12. Port each playground route to its `src/routes/*` file. Replace the inline
    `kv.get/set/list` calls with the Firestore wrapper.
13. Add `Deno.test`s for normalizers (phone, stage), the appointment heuristic,
    and the audit dedupe (`saveAuditMarker` claim/override semantics).
14. Run `shape-checker` from the project root; address suggestions.
15. Smoke-test the dashboard locally — should render with migrated data.

### Phase 3 — port the omnisource SMS pipeline (2-4 days)

16. For each module under `_source-omnisource/sms-flow/`:
    - **kv/** → already replaced by `src/firestore/`; move the type defs
      (`SmsFlowContext`, `ConversationMessage`, `FutureInjection`) into
      `src/types/`.
    - **rate-limiter/**, **ab-test/**, **crm/**, **lead-orchestrator/** → strip
      `@Injectable`/`@Logger`, convert classes to factory functions, replace
      `node:http`/`node:https` with `fetch`.
    - **readymode/** (config, dto, mapping, service, campaigns) → port
      wholesale; this is the biggest module.
    - **trigger/**, **callback/**, **queue/** → port the controllers as plain
      `Deno.serve` route handlers.
17. Wire all routes into `src/server.ts`.
18. Implement `/api/guests/activate-from-report` (the new sale-match cron
    entry).
19. Tests: unit tests for the Quickbase phone-format normalization, the 7-day
    window check, the disposition switch in `/sms-callback/disposition`, and the
    gatekeepers in `/trigger/readymode`.
20. Run `shape-checker` again.

### Phase 4 — deploy + cutover (half day)

21. Create the Deno Deploy project, set all env vars from §13.
22. Deploy. Verify `/healthz`.
23. Run
    `Deno.cron("scheduled-injection-sweep", "* * * * *", () => fetch("/api/cron/trigger"))`
    inside the app, OR keep the existing external cron site and have it hit
    `/api/cron/trigger` every N minutes.
24. Repoint the daily cron site from the legacy `guest-activation/from-report`
    URL to the new `/api/guests/activate-from-report`.
25. Repoint the two ngrok tunnels (`conf-deploy.ngrok.app`,
    `conf-omnisource.ngrok.app`) at the new Deno Deploy URL — or change
    Bland/ReadyMode/Cal.com webhooks directly.
26. Watch logs for 24–48 hours. Keep the legacy KV deploy running read-only as a
    fallback until you're confident.

### Phase 5 — cleanup (1 hour)

27. Once the new app is stable, decommission
    `google-sheets-kv.thetechgoose.deno.net`.
28. Delete `_source-omnisource/` (or move it out of the repo).
29. Delete the legacy cron site if it had its own deploy.

---

## 17. Source folder map (`_source-omnisource/sms-flow/`)

What's in the dump and what to do with each piece during the port:

| Path                                            | Contents                                                  | Port plan                                                                                     |
| ----------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| `mod.ts`                                        | NestJS `@Module` declaration                              | Discard — not needed in Deno.serve world                                                      |
| `ab-test/mod.ts`                                | A/B variant assignment                                    | Port to `src/services/ab-test/`                                                               |
| `callback/mod.ts`                               | All `/sms-callback/*` controllers (single big file)       | Split per route into `src/routes/callback/`                                                   |
| `crm/mod.ts` + `crm/dto/*`                      | Quickbase magic-mirror lookup                             | Port to `src/services/crm/` using your Quickbase client                                       |
| `kv/mod.ts`                                     | HTTP client for legacy Deno KV                            | Discard — replaced by `src/firestore/client.ts`                                               |
| `lead-orchestrator/{controller,service}/mod.ts` | Lead pointer + event log                                  | Port controller routes to `src/routes/orchestrator/`, service to `src/services/orchestrator/` |
| `queue/mod.ts`                                  | `/sms-flow/queue/trigger` handler                         | Port to `src/routes/queue/`                                                                   |
| `rate-limiter/mod.ts`                           | Per-phone 30-day gate                                     | Port to `src/services/rate-limiter/`                                                          |
| `readymode/config/mod.ts`                       | The `DOMAIN_CONFIG` table                                 | Port to `src/services/readymode/config.ts`                                                    |
| `readymode/dto/mod.ts`                          | DialerDomain enum + DTOs                                  | Port to `src/types/readymode.ts`                                                              |
| `readymode/mapping/mod.ts`                      | Inbound→standardLead and standardLead→per-domain mappings | Port to `src/services/readymode/mapping.ts`                                                   |
| `readymode/service/mod.ts`                      | Inject/scrub/DNC/SMS-send orchestration (largest file)    | Port to `src/services/readymode/service.ts`                                                   |
| `readymode/campaigns/*`                         | Campaign config tables                                    | Port to `src/services/readymode/campaigns.ts`                                                 |
| `trigger/mod.ts`                                | `/trigger/readymode` + `/trigger/manual` controllers      | Port to `src/routes/trigger/`                                                                 |

---

## 18. Open questions (fill in as decisions land)

- [ ] Quickbase auth model for non-`getReports` operations (user token? app
      token?). Add env vars to §13 once decided.
- [x] **Resolved** — Deno Deploy's built-in `Deno.cron` for the
      scheduled-injection sweep (decoupled from external cron, see §0.6).
- [x] **Resolved** — composite indexes live in
      [firestore.indexes.json](firestore.indexes.json); see §6 schema.
- [x] **Resolved** — webhooks moved to clean `/sms-callback/*`, `/trigger/*`,
      `/cal/*` paths; ngrok tunnels repointed (§0.1).
- [x] **Resolved** — `seedConversations` backfill endpoint exists at
      `POST /sms-callback/seed-conversations` (see §0.5).
- [x] **Resolved** — DNC lives in its own `sms-bot/dnc/byPhone/{phone10}`
      collection (§6 schema).
