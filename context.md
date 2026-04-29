# sms-bot — Consolidation Context

This packet is the starting point for consolidating three legacy systems into one Deno Deploy project:

1. **omnisource sms-flow module** — the SMS pipeline (lead intake, ReadyMode injection/scrub, Bland.ai send, Cal.com appointment hook, lead orchestration). Code dump in `_source-omnisource/sms-flow/`.
2. **Daily cron site** — *not* being ported. It just POSTs once a day to a single endpoint. The new app needs to expose that endpoint (`/api/guests/activate-from-report`); the cron URL will be repointed when the new app is live.
3. **Deno KV playground** — the dashboards, conversation search, audit search, scheduled-injection UI, nightly Postmark report, KV CRUD, and the existing `/api/guests/activate` + `/api/guests/answered` + `/api/sales/record` endpoints. The user has saved its `main.ts` into this folder as the canonical reference.

This document is the spec. Edit freely as decisions land.

---

## 1. Project goals

- **Single Deno Deploy app** at `~/Programming/sms-bot/` serving every endpoint that the three legacy systems served.
- **Firestore-backed** (replacing the existing Deno KV deploy at `google-sheets-kv.thetechgoose.deno.net`). All writes go to a single root collection `sms-bot`. Service account is already provisioned by the user.
- **One-time historical migration** from existing Deno KV → Firestore via [scripts/migrate-kv-to-firestore.ts](scripts/migrate-kv-to-firestore.ts).
- **New "sale match" flow:** a daily cron-fired endpoint pulls a Quickbase report of phones booked today and marks each as a sale (within a 7-day-from-appointment window) for productivity reporting.
- `Deno.test` coverage as we go; `shape-checker` (run from the project root) to keep file structure sane.

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

**Process:** single Deno Deploy isolate. `Deno.serve` + a path-based router. No NestJS — the omnisource `@nestjs/common` decorators are stripped during port; constructors become factory functions, classes become objects of methods.

**Storage:** Firestore (not Deno KV). Single root collection `sms-bot`. The legacy code uses HTTP-fronted Deno KV; we replace `SmsFlowStateService.request(...)` with direct Firestore SDK calls via a thin wrapper that exposes `get/set/delete/list(prefix)` so the playground's existing route handlers can be ported with minimal changes.

**Cron:** the daily external cron site continues to exist outside this project. It POSTs to `/api/guests/activate-from-report` (see §6). Inside the app, the playground's `/api/cron/trigger` endpoint also remains for processing scheduled SMS injections — it can be triggered by Deno Deploy's built-in cron or the same external cron site.

**Outbound calls:** Bland.ai (SMS), Postmark (email), Quickbase (reads), ReadyMode (5 dialer subdomains, lead inject/scrub/DNC), and the two ngrok tunnels for `talk-now` callbacks (`conf-deploy.ngrok.app` prod, `conf-omnisource.ngrok.app` test).

---

## 4. End-to-end flows

### 4.1 Inbound lead → first SMS sent

1. ReadyMode dialer POSTs `POST /trigger/readymode` (or test path `POST /trigger/manual` with `?override=true`).
2. Gatekeepers (skipped if `override=true`):
   - attempts ≥ 40
   - global daily SMS count < 100 (Eastern Time)
   - DNC check (Quickbase + KV opt-out flag)
   - 30-day rate limit (per phone)
3. CRM enrichment via Quickbase magic-mirror (lookup by ResID).
4. A/B variant toggle (Firestore-backed).
5. Conversation history fetched.
6. SMS send via Bland.ai (pathway `d6bd66a2-13b4-4365-a994-842c705e22b1`, agent `+18435488335`, `pathway_version: "production"`).
7. Persist SMS flow context, lead pointer, orchestrator event.
8. Response: `{status: "success", variant: "A"|"B"}`.

### 4.2 Guest replies → conversation continues

Bland.ai webhooks externally; the conversation messages get stored under `sms-bot/conversations/messages/{...}` keyed by phone10 + callId + timestamp. The playground's `/search` UI + `/api/conversations/search2` query this.

### 4.3 Guest opts in → Cal.com sends invite → appointment booked

1. Cal.com (or Bland flow) POSTs `POST /sms-callback/appointment-booked` with `{phone, event_time}`.
2. Scrub the lead from its current ReadyMode source domain (read pointer → ReadyMode TPI scrub).
3. Save `sms-bot/scheduledinjections/byPhone/{phone10}` = `{phone, eventTime, scheduledAt, isTest}`.
4. The Deno Deploy cron (or external cron) hits `GET /api/cron/trigger` periodically. That handler iterates `scheduledinjections/byPhone/*`, finds entries whose `eventTime <= now`, POSTs to the appropriate `talk-now` ngrok URL, writes a `injectionhistory` record, and deletes the scheduled-injection doc.

### 4.4 Call ends → disposition handled

1. Dialer POSTs `POST /sms-callback/disposition` with `{phone, disposition, campaign_name?}`.
2. If disposition is `sale`/`booked`: do nothing (lead exits funnel).
3. Else if currently in ODR (or ODR-mapped campaign): scrub from ODR, return to original source domain.
4. Else: standard recycle — scrub source, inject into recycle target if mapped.

### 4.5 Guest opts out → STOP

1. POST `/sms-callback/stop` with `{phone}`.
2. Mark DNC in Quickbase + Firestore opt-out flag (`doNotText: true` on conversation entries / a dedicated `dnc/byPhone/{phone10}` doc).

### 4.6 Daily sale match (NEW)

1. External cron POSTs `POST /api/guests/activate-from-report` with empty body once per day.
2. Server fetches the bookings report from Quickbase: `POST https://us-central1-crm-sdk.cloudfunctions.net/getReports` body `{test: <env QUICKBASE_REPORT_TOKEN>, tableID: "bpb28qsnn", reportID: "530"}`.
3. Response shape: `{data: [{"48": {value: "(XXX) XXX-XXXX"}, "-1": {value: "YYYY-MM-DD"}, "-100": {value: "7 Days"}, "-101": {value: "Active Date Legs"}}, ...]}`. Field `48` is the phone (formatted, normalize to 10 digits).
4. For each phone10:
   - Look up `sms-bot/scheduledinjections/byPhone/{phone10}`.
   - If present and `eventTime` was within the last 7 days, write `sms-bot/saleswithin7d/byPhone/{phone10}` with `{phone10, phone11, appointmentAt, saleAt, windowDays: 7, withinDays, updatedAt}`.
   - Also write `sms-bot/guestactivated/byPhone/{phone10}` with `{phone10, Activated: true, activatedAt, eventTime}` for dashboard parity.
5. Return summary: `{processed, matched, skipped}`.

This is the same logic as `/api/sales/record` in the playground, just batched and self-driven.

---

## 5. Endpoint inventory (consolidated app)

| Method | Path | Source | Purpose |
|---|---|---|---|
| GET | `/` | playground | Landing page (HTML) |
| GET | `/dashboard` | playground | Analytics dashboard (HTML) |
| GET | `/search` | playground | Conversation search UI (HTML) |
| GET | `/audit` | playground | Audit record search (HTML) |
| GET | `/injections` | playground | Scheduled injections UI (HTML) |
| GET | `/review` | playground | Daily response review UI (HTML) |
| GET | `/api/dashboard/stats` | playground | Aggregate counts |
| GET | `/api/dashboard/drill` | playground | Drill-in for stat cards |
| GET | `/api/appointments` | playground | Appointment-tagged conversations (paged) |
| GET | `/api/conversations/search` | playground | Legacy by-phone search |
| GET | `/api/conversations/search2` | playground | Filtered by-phone search |
| GET | `/api/audit/browse` | playground | Paged audit records |
| GET | `/api/audit/check` | playground | Single record dedupe check |
| GET | `/api/audit/status` | playground | Multi-stage status |
| POST | `/api/audit/save` | playground | Write audit marker (claim/override) |
| GET / POST | `/` (with `?recordId=` or POST body) | playground | LEGACY audit root — keep for callers |
| GET | `/api/state` | playground | Read `config/settings/state` doc |
| GET | `/api/kv/get` | playground | Admin: raw doc read |
| POST | `/api/kv/set` | playground | Admin: raw doc write |
| DELETE | `/api/kv/delete` | playground | Admin: raw doc delete |
| POST | `/api/kv/list` | playground | Admin: prefix listing (now: subcollection list) |
| POST | `/api/injection/schedule` | playground | Schedule a future SMS injection |
| DELETE | `/api/injection/cancel` | playground | Cancel a scheduled injection |
| GET / POST | `/api/cron/trigger` | playground | Process all scheduled injections whose eventTime ≤ now |
| GET | `/api/cron/trigger-single` | playground | Force-fire one injection by phone |
| POST | `/api/sales/record` | playground | Manual single-phone sale match |
| POST | `/api/guests/activate` | playground | Bulk SHA-256 phone activation (existing flow) |
| POST | `/api/guests/activate-from-report` | **NEW** | Daily cron entry: pull QB report → match → mark sales |
| POST | `/api/guests/answered` | playground | Mark guest answered the call |
| POST | `/api/sms/count` | playground | Today's SMS count (token-gated) |
| GET / POST | `/api/report/nightly` | playground | Send Postmark email with stats + CSV |
| POST | `/trigger/readymode` | omnisource | ReadyMode dialer webhook → SMS send |
| POST | `/trigger/manual` | omnisource | Test override (skips all gatekeepers) |
| POST | `/sms-callback/bland/talk-now` | omnisource | Hot-path: scrub source → inject ODR |
| POST | `/sms-callback/appointment-booked` | omnisource | Cal.com booked → schedule future injection |
| POST | `/sms-callback/disposition` | omnisource | Post-call disposition handling |
| POST | `/sms-callback/stop` | omnisource | STOP → DNC |
| POST | `/sms-callback/return-to-source` | omnisource | Return lead to original source domain |
| POST | `/sms-flow/queue/trigger` | omnisource | KV cron fires when scheduled time reached |
| GET | `/sms-flow/orchestrator/pointer/:phone` | omnisource | Read lead's current location state |
| GET | `/sms-flow/orchestrator/events/:phone` | omnisource | Read lead's audit trail |

> The omnisource ngrok tunnels (`conf-deploy.ngrok.app/confirmations/v001/...` etc.) currently route to the legacy app. Once the new app is deployed, those ngrok tunnels need to be repointed to the new Deno Deploy URL.

---

## 6. Firestore schema

Single root collection: **`sms-bot`**. Beneath it, one document per data category, each holding a subcollection (or further docs) with the actual records. This keeps the project's data fully isolated under one collection name as required.

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

**Recommended Firestore indexes** (composite — define in `firestore.indexes.json`):
- `sms-bot/conversations/messages` — `(phoneNumber asc, timestamp desc)`, `(sender asc, timestamp desc)`, `(nodeTag asc, timestamp desc)`
- `sms-bot/injectionhistory/byPhone` — `(phone asc, firedAt desc)`
- `sms-bot/scheduledinjections/byPhone` — `(eventTime asc)` for the cron sweep

---

## 7. KV → Firestore migration

### Prerequisites

- Service account JSON for the user's GCP project (already exists).
- Firestore in **Native mode** (not Datastore mode) on that project. If not enabled yet:
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

To migrate one prefix at a time (recommended for the large `conversations` prefix):

```bash
deno run -A scripts/migrate-kv-to-firestore.ts --prefix=conversations --limit=50000
```

### What the script does

- Iterates each known KV prefix (`conversations`, `scheduledinjection`, `smsflowcontext`, `guestactivated`, `guestanswered`, `audit`, `auditstage`, `saleswithin7d`, `injectionhistory`, `config`).
- Calls `POST {SOURCE_KV_URL}/api/kv/list` with `{prefix: [<name>], limit: <n>}` to enumerate every entry.
- Transforms each KV key → Firestore doc path per the schema in §6, preserves `value`, and stores the original KV key in a `_kvKey` field on each doc for traceability.
- Writes via Firestore batch (max 400 ops per batch).

### Caveats

- The legacy `/api/kv/list` endpoint does **not** support cursor pagination — it just returns up to `limit` entries in one shot. For prefixes larger than ~10k entries, either:
  - Bump `--limit` to a high number and trust the request to complete, or
  - Add cursor support to the legacy endpoint before running.
- The script is idempotent for fixed-key prefixes (re-running overwrites the same doc). For `conversations` and `injectionhistory` (which use composed deterministic IDs), reruns also overwrite.

---

## 8. Quickbase requirements

You'll wire up the Quickbase service yourself using context from your other project. The new sms-bot app needs the following operations to exist on whatever client you provide. List shows: **operation → input → expected output → why it's needed**.

| Operation | Input | Output | Used by |
|---|---|---|---|
| `getReport(tableID, reportID)` | `tableID: string`, `reportID: string` | `{data: Array<{[fid: string|number]: {value: any}}>, fields: [...], metadata: {...}}` | Daily sale-match flow (`/api/guests/activate-from-report`) — fetches phones booked today |
| `findReservationByResID(resId)` | `resId: string` | `{phone, firstName, lastName, email?, ... }` or `null` | CRM enrichment during inbound lead processing (porting from omnisource `crm/mod.ts`) |
| `markDNC(phone)` | `phone: string` (10-digit) | `{success: boolean}` | STOP/opt-out handling (`/sms-callback/stop`) |
| `isDNC(phone)` | `phone: string` | `boolean` | Gatekeeper before sending SMS |

**Auth model:** The known `getReports` endpoint is the public Cloud Function `https://us-central1-crm-sdk.cloudfunctions.net/getReports` and is gated by the `test` body field acting as a shared-secret token. Other operations may need a Quickbase user token / app token / temporary auth token — your existing project will tell us what's needed. Document the auth pattern here once known:

- Env var name(s): `QUICKBASE_REPORT_TOKEN` (the `test` field for `getReports`); `QUICKBASE_USER_TOKEN` (likely needed for direct table writes/reads); other?
- Scopes/permissions required:
- Realm/host (e.g. `monsterrg.quickbase.com`):

**Reference response shape for `getReport(tableID="bpb28qsnn", reportID="530")`:**

```json
{
  "data": [
    {
      "48":   { "value": "(936) 676-2277" },
      "-1":   { "value": "2026-04-20" },
      "-100": { "value": "7 Days" },
      "-101": { "value": "Active Date Legs" }
    }
  ],
  "fields": [
    { "id": 48,   "label": "Reservation - Phone Number", "type": "phone" },
    { "id": -1,   "label": "Added", "type": "date" },
    { "id": -100, "label": "Expiry Date", "type": "text" },
    { "id": -101, "label": "Reason", "type": "text" }
  ],
  "metadata": { "numFields": 4, "numRecords": 110, "totalRecords": 110, "skip": 0 }
}
```

The phone in field `48` is formatted `(XXX) XXX-XXXX` — normalize to 10 digits before lookup.

---

## 9. Bland.ai requirements

- **API base:** `https://api.bland.ai/v1/sms/conversations`
- **Auth:** `Authorization: <api_key>` header (no `Bearer` prefix in legacy code — verify against Bland docs).
- **Pathway ID:** `d6bd66a2-13b4-4365-a994-842c705e22b1` (overrideable via `BLAND_SMS_PATHWAY_ID` env var).
- **Pathway version:** `production` (currently hardcoded; consider env-toggling).
- **Agent number:** `+18435488335`.
- **Inbound webhook target:** Bland.ai is configured to POST to the `talk-now` ngrok tunnel; once the new app is deployed, repoint that webhook to the new public URL.
- Operations to port from omnisource: create conversation, list today's conversations, fetch/seed conversation messages, trigger talk-now.
- Env vars: `BLAND_API_KEY`, `NU_BLAND_API_KEY` (legacy fallback), `BLAND_SMS_PATHWAY_ID` (optional override).

---

## 10. Postmark requirements

- **Library:** `npm:postmark` (`ServerClient`).
- **From:** `notifications@monsterrg.com`.
- **To (default):** `adamp@monsterrg.com`.
- **Used by:** `/api/report/nightly` (HTML email with stats table + conversations CSV attached).
- Env var: `POSTMARK_SERVER` (Postmark server token).

---

## 11. ReadyMode requirements

5 dialer subdomains, each with its own `lead-api` slug for lead injection (3 of 5) and a `TPI/lead` scrub endpoint (all 5). Defined in `_source-omnisource/sms-flow/readymode/config/mod.ts`.

| Domain key | Host | Lead-API slug | Has injection? |
|---|---|---|---|
| `MONSTER` | `https://monsterrg.readymode.com` | `8qhAtb6vnrxb` | ✅ |
| `ODS` | `https://monsterods.readymode.com` | `s2fyaY95pAC2` | ✅ |
| `ODR` | `https://monsterodr.readymode.com` | `wCoocn6CrCZc` | ✅ |
| `ACT` | `https://monsteract.readymode.com` | — | ❌ scrub only |
| `DS` | `https://monsterrd2.readymode.com` | — | ❌ scrub only |

**Auth:** Basic auth with `RM_USER`/`RM_PASS` (or per-domain `RM_{DOMAIN}_USER`/`RM_{DOMAIN}_PASS`). Legacy code defaults to hardcoded `adam`/`Winter123` if env vars are missing — replace defaults with explicit env vars in the new app and fail fast if missing.

**Operations:**
- `injectLead(domain, params)` → `POST {host}/lead-api/{slug}`
- `scrubLead(domain, phone)` → `POST {host}/TPI/lead` with scrub flag
- `markDNC(domain, phone)` → `POST {host}/TPI/DNC`

Field mappings live in `_source-omnisource/sms-flow/readymode/mapping/mod.ts` (normalize inbound webhook → standardLead, then denormalize standardLead → per-domain payload).

---

## 12. Cal.com integration

Cal.com is the booking layer. The relevant touchpoint is `POST /sms-callback/appointment-booked` — Cal.com (or whatever sits in front of Cal.com) hits that endpoint when a guest books, with `{phone, event_time}`. The new app:

1. Resolves the lead's current source domain via `leadpointer/byPhone/{phone10}`.
2. Scrubs from that domain.
3. Writes `scheduledinjections/byPhone/{phone10}` with `eventTime: event_time`.

No outbound Cal.com API calls are needed in this consolidation — Cal.com pushes to us, we don't pull. If/when that changes, document the API key and endpoint here.

---

## 13. Env vars (full list)

| Name | Purpose | Required |
|---|---|---|
| `FIREBASE_PROJECT_ID` | GCP project hosting the Firestore DB | ✅ |
| `GOOGLE_APPLICATION_CREDENTIALS` (local) **or** `FIREBASE_SERVICE_ACCOUNT_JSON` (Deno Deploy, raw JSON string) | Service account auth | ✅ |
| `BLAND_API_KEY` | Bland.ai SMS auth | ✅ |
| `NU_BLAND_API_KEY` | Bland.ai legacy fallback | optional |
| `BLAND_SMS_PATHWAY_ID` | Override default pathway | optional |
| `POSTMARK_SERVER` | Postmark server token | ✅ (for nightly report) |
| `QUICKBASE_REPORT_TOKEN` | The `test` body field for the `getReports` Cloud Function | ✅ |
| `QUICKBASE_USER_TOKEN` | Quickbase API user token (if direct API access is needed) | TBD |
| `QUICKBASE_REALM` | Quickbase realm host (e.g. `monsterrg.quickbase.com`) | TBD |
| `RM_USER` / `RM_PASS` | ReadyMode default Basic auth | ✅ |
| `RM_MONSTER_USER` / `RM_MONSTER_PASS` | Per-domain override | optional |
| `RM_ODS_USER` / `RM_ODS_PASS` | Per-domain override | optional |
| `RM_ODR_USER` / `RM_ODR_PASS` | Per-domain override | optional |
| `RM_ACT_USER` / `RM_ACT_PASS` | Per-domain override | optional |
| `RM_DS_USER` / `RM_DS_PASS` | Per-domain override | optional |
| `KV_SERVICE_URL` | NOT used by new app — only the migration script uses it (renamed `SOURCE_KV_URL`) | n/a |
| `CRON_SHARED_SECRET` | Shared secret the external cron site sends in a header so `/api/guests/activate-from-report` can reject random callers | recommended |
| `SMS_COUNT_TOKEN` | The `test` body field for `/api/sms/count` (currently hardcoded base64 in playground — extract to env) | recommended |

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

The legacy `/api/cron/trigger` endpoint also stays — it may be triggered by a separate cron or by Deno Deploy's built-in cron API to process scheduled SMS injections every minute.

---

## 15. Gotchas (from omnisource)

- **No injection lock.** A previous lock mechanism caused triple-injections; it was removed in favor of a preemptive scrub. Don't reintroduce a lock without testing.
- **Conversation lookup race.** The `lookup_call_id → phone` secondary index must be written *before* messages are stored or `getConversationByCallId` will fail. Backfill endpoint exists in legacy code (callback/mod.ts:735); port it.
- **`?override=true` skips everything.** All gatekeepers (attempts, daily cap, DNC, rate limit) bypassed. Used only by `/trigger/manual`.
- **Global daily SMS cap = 100, hardcoded, Eastern Time.** Lives at one shared counter, not per-domain.
- **Hardcoded ReadyMode credentials.** Legacy defaults to `adam`/`Winter123` if env vars missing. New app should fail fast instead.
- **`pathway_version: "production"` is hardcoded.** No env toggle in legacy; consider adding one.
- **Quickbase magic-mirror returns array-like, not Promise.** Legacy code does `.sortByDateModified("desc")[0]` — verify behavior when porting.
- **Conversation seeding has built-in delays.** 100ms between messages, 300ms between conversation IDs, to avoid overwhelming remote KV. With Firestore batched writes this is no longer needed, but verify Bland API rate limits separately.
- **Talk-now scrub is optional.** Proceeds even if no source domain is on the lead pointer.
- **Ngrok tunnel aliases.** `conf-deploy.ngrok.app/confirmations/v001/sms-callback/bland/talk-now` (prod) and `conf-omnisource.ngrok.app/confirmations/v001/sms-callback/bland/talk-now` (test) currently route to the legacy app. After deploy, either repoint the tunnels at the new Deno Deploy URL **or** mount the new handlers under `/confirmations/v001/...` so the existing tunnels keep working without changes.
- **Phone-number format inconsistencies.** Inbound from Quickbase report = `(XXX) XXX-XXXX`; Bland = E.164; ReadyMode = digits only; KV keys = 10 digits. Always normalize at the edge.

---

## 16. Build plan (step by step)

### Phase 0 — bootstrap (1 hour)

1. `cd ~/Programming/sms-bot`
2. Drop your saved playground `main.ts` at the repo root as a reference (don't import from it).
3. Create `deno.json` with import map for `npm:postmark`, `npm:firebase-admin`, and tasks for `dev`, `test`, `migrate`, `shape-check`.
4. Create `src/server.ts` with a minimal `Deno.serve` that 200s `GET /healthz`. Verify locally: `deno task dev`.
5. Set env vars locally via a `.env` file (gitignored) + a `.env.example` that lists every variable from §13.

### Phase 1 — Firestore wrapper + migration dry-run (2-3 hours)

6. Create `src/firestore/client.ts`: thin wrapper exposing `get(path)`, `set(path, data)`, `delete(path)`, and `list(parentPath, opts)` over `npm:firebase-admin/firestore`.
7. Add `src/firestore/keys.ts` with helpers like `conversationDocPath(phone10, callId, ts)` and `scheduledInjectionPath(phone10)` mirroring §6.
8. Run the migration script in dry-run against a tiny prefix: `deno run -A scripts/migrate-kv-to-firestore.ts --dry-run --prefix=config`. Check the path/data output.
9. Real run for small prefixes (`config`, `saleswithin7d`, `injectionhistory`).
10. Real run for `conversations` + `scheduledinjection` (the large ones) — bump `--limit` if needed.

### Phase 2 — port the playground UI/API surface (1-2 days)

11. Move HTML strings (`homePageHtml`, `dashboardHtml`, `auditSearchHtml`, `searchPageHtml`, `injectionsPageHtml`, `reviewPageHtml`, `sharedThemeCss`) into `src/ui/*.ts`.
12. Port each playground route to its `src/routes/*` file. Replace the inline `kv.get/set/list` calls with the Firestore wrapper.
13. Add `Deno.test`s for normalizers (phone, stage), the appointment heuristic, and the audit dedupe (`saveAuditMarker` claim/override semantics).
14. Run `shape-checker` from the project root; address suggestions.
15. Smoke-test the dashboard locally — should render with migrated data.

### Phase 3 — port the omnisource SMS pipeline (2-4 days)

16. For each module under `_source-omnisource/sms-flow/`:
    - **kv/** → already replaced by `src/firestore/`; move the type defs (`SmsFlowContext`, `ConversationMessage`, `FutureInjection`) into `src/types/`.
    - **rate-limiter/**, **ab-test/**, **crm/**, **lead-orchestrator/** → strip `@Injectable`/`@Logger`, convert classes to factory functions, replace `node:http`/`node:https` with `fetch`.
    - **readymode/** (config, dto, mapping, service, campaigns) → port wholesale; this is the biggest module.
    - **trigger/**, **callback/**, **queue/** → port the controllers as plain `Deno.serve` route handlers.
17. Wire all routes into `src/server.ts`.
18. Implement `/api/guests/activate-from-report` (the new sale-match cron entry).
19. Tests: unit tests for the Quickbase phone-format normalization, the 7-day window check, the disposition switch in `/sms-callback/disposition`, and the gatekeepers in `/trigger/readymode`.
20. Run `shape-checker` again.

### Phase 4 — deploy + cutover (half day)

21. Create the Deno Deploy project, set all env vars from §13.
22. Deploy. Verify `/healthz`.
23. Run `Deno.cron("scheduled-injection-sweep", "* * * * *", () => fetch("/api/cron/trigger"))` inside the app, OR keep the existing external cron site and have it hit `/api/cron/trigger` every N minutes.
24. Repoint the daily cron site from the legacy `guest-activation/from-report` URL to the new `/api/guests/activate-from-report`.
25. Repoint the two ngrok tunnels (`conf-deploy.ngrok.app`, `conf-omnisource.ngrok.app`) at the new Deno Deploy URL — or change Bland/ReadyMode/Cal.com webhooks directly.
26. Watch logs for 24–48 hours. Keep the legacy KV deploy running read-only as a fallback until you're confident.

### Phase 5 — cleanup (1 hour)

27. Once the new app is stable, decommission `google-sheets-kv.thetechgoose.deno.net`.
28. Delete `_source-omnisource/` (or move it out of the repo).
29. Delete the legacy cron site if it had its own deploy.

---

## 17. Source folder map (`_source-omnisource/sms-flow/`)

What's in the dump and what to do with each piece during the port:

| Path | Contents | Port plan |
|---|---|---|
| `mod.ts` | NestJS `@Module` declaration | Discard — not needed in Deno.serve world |
| `ab-test/mod.ts` | A/B variant assignment | Port to `src/services/ab-test/` |
| `callback/mod.ts` | All `/sms-callback/*` controllers (single big file) | Split per route into `src/routes/callback/` |
| `crm/mod.ts` + `crm/dto/*` | Quickbase magic-mirror lookup | Port to `src/services/crm/` using your Quickbase client |
| `kv/mod.ts` | HTTP client for legacy Deno KV | Discard — replaced by `src/firestore/client.ts` |
| `lead-orchestrator/{controller,service}/mod.ts` | Lead pointer + event log | Port controller routes to `src/routes/orchestrator/`, service to `src/services/orchestrator/` |
| `queue/mod.ts` | `/sms-flow/queue/trigger` handler | Port to `src/routes/queue/` |
| `rate-limiter/mod.ts` | Per-phone 30-day gate | Port to `src/services/rate-limiter/` |
| `readymode/config/mod.ts` | The `DOMAIN_CONFIG` table | Port to `src/services/readymode/config.ts` |
| `readymode/dto/mod.ts` | DialerDomain enum + DTOs | Port to `src/types/readymode.ts` |
| `readymode/mapping/mod.ts` | Inbound→standardLead and standardLead→per-domain mappings | Port to `src/services/readymode/mapping.ts` |
| `readymode/service/mod.ts` | Inject/scrub/DNC/SMS-send orchestration (largest file) | Port to `src/services/readymode/service.ts` |
| `readymode/campaigns/*` | Campaign config tables | Port to `src/services/readymode/campaigns.ts` |
| `trigger/mod.ts` | `/trigger/readymode` + `/trigger/manual` controllers | Port to `src/routes/trigger/` |

---

## 18. Open questions (fill in as decisions land)

- [ ] Quickbase auth model for non-`getReports` operations (user token? app token?). Add env vars to §13 once decided.
- [ ] Do we want Deno Deploy's built-in `Deno.cron` for the scheduled-injection sweep, or keep the external cron model? (Built-in cron is simpler; external cron decouples scheduling from the deploy.)
- [ ] Indexes: which composite indexes do we actually need on day 1 vs. add later when queries get slow?
- [ ] Backwards-compat for the ngrok tunnels — repoint them, or mount handlers at `/confirmations/v001/...` to keep them working unchanged?
- [ ] Do we need to port the `seedConversations` backfill endpoint, or is migration via the script enough?
- [ ] DNC: separate Firestore collection (`dnc/byPhone/{phone10}`) or just a flag inside `smsflowcontext`?
