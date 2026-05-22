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
- **shape-checker abandoned** — fundamentally incompatible with Fresh's
  `routes/` convention. The script is still wired to `deno task shape-check` for
  completeness; ignore its output.
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

| Var                              | Required                         | Purpose                                                | Notes                                                              |
| -------------------------------- | -------------------------------- | ------------------------------------------------------ | ------------------------------------------------------------------ |
| `FIREBASE_PROJECT_ID`            | ✅                               | GCP project ID                                         | `keystone-fs97`                                                    |
| `FIREBASE_SERVICE_ACCOUNT_JSON`  | ✅ on Deploy                     | Raw JSON of service account                            | Paste the whole `{...}` blob                                       |
| `GOOGLE_APPLICATION_CREDENTIALS` | ✅ local                         | Path to service-account JSON file                      | e.g. `./data/service-account.dev.json` (gitignored)                |
| `BLAND_API_KEY`                  | ✅                               | Bland.ai API key                                       | Header: `authorization: <key>` (no Bearer prefix)                  |
| `NU_BLAND_API_KEY`               | optional                         | Bland fallback key                                     |                                                                    |
| `BLAND_SMS_PATHWAY_ID`           | optional                         | Pathway override                                       | Default: `d6bd66a2-13b4-4365-a994-842c705e22b1`                    |
| `BLAND_PATHWAY_VERSION`          | optional                         | Pathway version                                        | Default: `production`                                              |
| `POSTMARK_SERVER`                | required for /api/report/nightly | Postmark server token                                  |                                                                    |
| `QUICKBASE_REPORT_TOKEN`         | required for daily cron          | `test` body field for `getReports` Cloud Function      |                                                                    |
| `QUICKBASE_USER_TOKEN`           | required for direct QB ops       | User token from QB My Preferences → Manage user tokens | Raw token only, NOT a base64 headers blob                          |
| `QUICKBASE_FAIL_OPEN`            | optional                         | `true` (default) = QB outage soft-fails                | Flip to `false` once you trust QB wiring                           |
| `RM_USER`, `RM_PASS`             | ✅                               | ReadyMode TPI Basic-auth creds                         | Same creds work for all 5 domains (no per-domain overrides needed) |
| `CAL_API_KEY`                    | ✅ for Cal.com endpoints         | Cal.com v2 API key                                     | `cal_live_…` format                                                |
| `NGROK_KEY`                      | local dev only                   | ngrok auth token                                       | For `deno task tunnel`                                             |
| `SOURCE_KV_URL`                  | migration script only            | Legacy KV deploy URL                                   | `https://google-sheets-kv.thetechgoose.deno.net`                   |

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

**UI pages** (return HTML from `shared/ui/pages.ts`):

- `GET /` — landing (also handles legacy audit `?recordId` GET / POST)
- `GET /dashboard`, `/search`, `/audit`, `/injections`, `/review`
- `GET /test` — endpoint test console (8 sections, ~25 cards, sticky phone
  input, override toggle, response preview)
- `GET /healthz` — `{ok:true, service, time}`

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

### 0.6 Scheduled jobs (Deno.cron, Deploy-only)

In `main.ts`, gated on `DENO_DEPLOYMENT_ID`:

- **`scheduled-injection-sweep`** — every minute (`* * * * *`). Calls
  `sweepScheduledInjections("cron")`.
- **`daily-qb-sale-match`** — daily at `0 14 * * *` UTC = **10 AM ET / 9 AM
  EDT**. Calls `runDailyQbSaleMatch()` from
  `shared/services/sale-match/cron.ts`.

Edit cron expressions in `main.ts` to change schedules. Both also callable via
routes for manual firing.

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
deno task test         # 109 unit tests (all mocked)
deno task build        # Vite production build
deno task migrate      # KV → Firestore one-shot
deno task shape-check  # ignore output, structure incompatible with Fresh
```

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

- **Emulator tests** (`tests/emulator/*`) — never built. All 109 tests are
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
├── guestanswered (doc)
│   └── byPhone (subcollection)
│       └── {phone10}
│              { phone10, answered: true, answeredAt }
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
│   │            textsSent, updatedAt }             write site (atomic
│   └── lifetime (subcollection)                    FieldValue.increment).
│       └── totals                                  Report reads, never
│              { apptsBooked, activations,          scans.
│                textsSent, updatedAt }
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
