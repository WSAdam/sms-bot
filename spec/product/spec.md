# sms-bot — Product Spec

> **Reverse-engineered from the shipped app.** This document recovers the product
> intent of an application that is already in production at
> `https://sms-bot.thetechgoose.deno.net`. It was not written before the code; it
> is reconstructed from the live code surface and from `context.md` (the canonical
> "consolidation context" doc), which carries the intent behind the decisions. The
> code is ground truth; `context.md` is the why. Where the two disagree, the code
> wins and the discrepancy is noted.

## Thesis

Monster Reservations Group runs ReadyMode dialers that call cold reservation
leads dozens of times and never connect. Those leads are dead to the phone but
not necessarily dead to a text. **sms-bot** is the system that picks up those
abandoned leads, texts them, holds an SMS conversation through a Bland.ai
pathway, books an appointment via Cal.com, and then injects the now-warm lead
back into a dedicated ReadyMode "ODR – Appointments" campaign so a human sales
rep calls them at the right moment. Every step is throttled for safety, every
outcome is tracked, and the whole funnel — texts sent, calls scheduled, calls
answered, sales activated — is rolled up into a nightly email and a live
operator dashboard.

The product exists to **convert un-callable dialer leads into booked, dialed,
and ultimately sold appointments**, safely and observably, with one operator in
control.

## Goals

- **Resurrect abandoned dialer leads.** Text leads a ReadyMode dialer attempted
  40+ times without connecting, holding a real two-way SMS conversation through
  a Bland.ai pathway.
- **Never spam, never re-burn a lead.** A hard global cap of 100 texts/day
  (Eastern Time, one shared counter), a 30-day per-phone rate limit (the lead is
  never re-texted within the window), DNC enforcement, and an attempts
  threshold — all gates checked before any send.
- **Book and re-dial at the right time.** Capture Cal.com bookings, schedule a
  dialer re-injection for the appointment time, and at that time inject the
  warm lead into the ReadyMode "ODR – Appointments" campaign so a human calls.
- **Serve the "talk now" moment.** When a lead says they want to talk
  immediately, inject them into the dialer right away rather than waiting for a
  scheduled time.
- **Close the disposition loop.** Handle the post-call disposition: a sale/booked
  lead exits the funnel, a lead in ODR returns to its original source domain, and
  any other lead is recycled into its mapped target domain.
- **Measure "answered" honestly.** Pull ReadyMode's call log daily and decide
  which calls truly connected (campaign + duration gated), so the report's
  "calls answered" reflects real conversations, not mis-dispositions.
- **Attribute sales.** Match a Quickbase sale to a phone whose appointment fired
  within the last 7 days and mark it an "activation," for productivity reporting.
- **Give one operator full control + visibility.** A dashboard with drill-ins, a
  nightly Eastern-Time email, live-editable gates and cron config, manual cron
  triggers for recovery, and an external canary monitor that pages when sending
  stalls or a hard error persists.
- **Be safe by construction.** No request-path code scans an unbounded
  collection (every read filters at the database, uses a write-side aggregator,
  or is a single keyed get); hot-path counters are atomic; the sweep ships paused
  behind a live kill-switch.

## Non-goals

- **Not a cold-outreach blaster.** It only texts leads a dialer already
  exhausted — it does not source or cold-text net-new leads.
- **Not the dialer.** ReadyMode owns the actual phone calls and dispositions;
  sms-bot injects/scrubs leads and reads the call log, but never dials.
- **Not a Cal.com inbound webhook consumer.** The app initiates bookings;
  Cal.com does not currently call back into us (the appointment-booked path is
  driven by our own flow / Bland, not a Cal.com → us webhook).
- **Not multi-tenant.** Single Deno Deploy app, single Firestore root
  collection (`sms-bot`), single operator team (`monsterrg.com`).
- **Not a general CRM.** Quickbase remains the system of record for
  reservations and sales; we only read it (reservation lookup, DNC, sale report)
  and never write the customer record.

## The heart — the lead lifecycle as a one-way funnel

The core mechanism is a **gated, append-only funnel that a lead walks once**,
with each transition mediated by a "lead pointer" that records where the lead
currently lives in the ReadyMode domain topology.

1. **Intake.** ReadyMode posts `/trigger/readymode` (or the operator fires
   `/trigger/manual`). A gate stack runs in order: attempts ≥ 40 → global daily
   cap < 100 (ET) → DNC (Quickbase + local opt-out) → 30-day per-phone rate
   limit. The cap and limiter are **reserved atomically before the send and
   released if the send fails**, so a transient Bland error never burns a slot
   or locks a phone for 30 days.
2. **First SMS.** CRM enrichment (Quickbase reservation lookup by ResID), an A/B
   variant toggle, and a Bland.ai send via `/v1/sms/send` (pathway generates the
   opener; we omit `agent_message` on purpose). A lead pointer + orchestrator
   event are written.
3. **Conversation.** Bland posts each inbound/outbound message to
   `/sms-callback/conversation/:phone/:callId`; messages are stored keyed by
   phone + callId, with the callId→phone index written first.
4. **Booking.** A booking (Cal.com `/cal/schedule`, or the
   `/sms-callback/appointment-booked` signal) scrubs the lead from its current
   source domain and writes a `scheduledinjection` for the appointment time, with
   the time **normalized to an unambiguous TZ-marked instant** (a guard that
   throws on a naive timestamp).
5. **The sweep.** Every minute a Deno.cron sweep fires any scheduled injection
   whose `eventTime <= now`, injecting the warm lead into "ODR – Appointments" so
   a human calls. The sweep is **paused by default behind a live kill-switch**
   and carries a 72h dedup guard.
6. **Talk-now.** Alternatively, `/sms-callback/bland-talk-now` injects the lead
   into ODR immediately and cleans up any companion scheduled doc.
7. **Disposition.** After the human call, `/sms-callback/disposition` routes the
   lead: sale/booked → exit; in ODR → return to original source; else → recycle.
8. **Answered.** The daily ReadyMode pull reads the call log for the
   Appointments campaign and marks a phone "answered" only if it had a real
   conversation (a non-No-Answer disposition ≥ 60s, or a "No Answer" that
   nonetheless ran ≥ 180s — a long No-Answer is almost always a mis-disposition).
9. **Activation.** The daily Quickbase sale-match marks a phone an activation
   when a QB sale lands within 7 days of its fired appointment.

The invariant that makes the funnel safe is **append-only writes + a single
lead-pointer source of truth + every transition guarded by a scrub-before-inject
and a dedup window** — there is deliberately no injection lock (a prior lock
caused triple-injections; a preemptive scrub replaced it).

## Architecture & data model

- **One Deno Deploy app** on the Fresh framework. Fresh serves both the operator
  UI (raw HTML strings) and every API/webhook handler under `routes/`
  (`trigger/`, `sms-callback/`, `cal/`, `sms-flow/`, `api/`, `canary/`).
- **Backend logic lives in `src/`** in the rune canonical module shape (8
  modules — core, sms-flow, crm, messaging, reporting, scheduling, auth, dialer —
  plus the kernel), with `shared/` holding re-export shims + the dashboard HTML.
  Fresh routes are thin adapters over `src/` business logic.
- **Firestore-backed**, single root collection `sms-bot`. Key collections:
  `conversations/messages`, `scheduledinjections`, `injectionhistory`,
  `leadpointer`, `orchestratorevents`, `smsflowcontext`, `guestanswered`,
  `guestactivated`, `saleswithin7d`, `calldispositions`, `ratelimit`,
  `globalsmscount`, `abtest`, plus write-side aggregators (`metrics/daily` +
  `metrics/lifetime`, `injectedphones`, `uniqueguestsbyphone`,
  `uniquerecipientbyphone`, `weeklyrecipientbyphoneweek`) and config docs
  (`gatesConfig`, `cronConfig`).
- **External services:** Bland.ai (SMS pathway), Cal.com (bookings), ReadyMode
  (5 dialer subdomains — lead inject/scrub/DNC + a portal call-log scrape),
  Quickbase (reservation lookup, DNC, sale report), Postmark (nightly email).
- **Six scheduled jobs** (Deno.cron, Deploy-only, each wrapped in
  `recordCronRun` for health markers): every-minute injection sweep, nightly
  conversation reseed + booking scan (3 AM ET), daily QB sale-match (4–5 AM ET),
  ReadyMode daily call-log pull (5:30 AM ET), kvBreakdown metrics refresh
  (1–2 AM ET), and the nightly report email (6:15 AM ET, deliberately after the
  two morning pulls so "answered" and "bookings" are settled).
- **Auth:** Firebase Google sign-in gates the dashboard + all `/api/*`; ID
  tokens verified locally against Google JWKs; session cookie signed with an HMAC
  secret derived from the service-account key. Webhook prefixes
  (`/trigger`, `/sms-callback`, `/cal`, `/sms-flow`, `/canary`, `/healthz`)
  bypass the session gate; `/canary/*` is bearer-authed instead. If the Firebase
  API key is unset, auth disables and every route is public (safe-default).
- **Safety rails:** a `list()` tripwire logs a stack trace if any single query
  exceeds 500 docs; counters are atomic (`FieldValue.increment`,
  transactional CAS); webhook handlers now return 502/400 on internal failure so
  upstreams retry instead of silently dropping.

## Milestones (retrospective capability ladder)

This is the order the capabilities were actually built into the shipped app.

- **M0 — Walking skeleton.** One Deno Deploy Fresh app, Firestore wrapper, the
  KV→Firestore migration, and the inbound trigger → gated → Bland first-SMS path.
- **M1 — Conversation capture.** Per-message Bland webhook receiver, the
  callId→phone index, search/review UIs, and seed/backfill of Bland history.
- **M2 — Booking + the sweep.** Cal.com booking, scheduled injection writes with
  TZ normalization, and the every-minute sweep that injects warm leads into ODR.
- **M3 — Hot path + dispositions.** Talk-now immediate injection, the 3-branch
  disposition handler, STOP/DNC across 5 domains, return-to-source.
- **M4 — Attribution.** Daily Quickbase sale-match (7-day activation window) and
  the manual single-phone sale match.
- **M5 — Answered tracking.** Daily ReadyMode portal call-log pull, the
  campaign + duration "answered" gate, and the per-day answered counter.
- **M6 — Reporting + dashboard.** The nightly Eastern-Time Postmark email
  (Yesterday funnel + WTD/lifetime), the operator dashboard with drill-ins, and
  the live-editable gates/cron config.
- **M7 — Ops hardening.** Cron-health markers, manual cron/admin triggers for
  recovery, the canary monitor, Firebase auth, and the May–June 2026 safety +
  correctness sweeps (atomicity, bounded reads, phantom-injection fixes).

## Resolved decisions

These are the choices already made and shipped, recovered from `context.md`'s
gotchas and incident write-ups. They are the most load-bearing part of this doc.

- **[DECISION] Internal `Deno.cron`, not an external cron site or auth tokens.**
  All six scheduled jobs run as literal `Deno.cron(...)` calls in `main.ts`
  (literal so Deno Deploy's build-time scanner registers them — a variable alias
  once silently un-registered the sweep for 16 days). The old
  `CRON_SHARED_SECRET` / `CRON_INTERNAL_TOKEN` / `SMS_COUNT_TOKEN` env vars were
  dropped; manual triggers are open routes fired from the Test page.

- **[DECISION] The sweep ships paused behind a live kill-switch
  (`gatesConfig.scheduledInjectionSweepEnabled`, default false).** After the
  2026-05-25 near-miss — the sweep came back from a 22-day outage and tried to
  fire 19 stale pending docs at once — the rule is **drain before unstick**: a
  paused-by-default sweep, a 60s-cached kill-switch flippable from the dashboard,
  and a 72h dedup guard inside `handleDelayedInjection`. Talk-now now deletes its
  companion scheduled doc to close the same race.

- **[DECISION] No injection lock — preemptive scrub instead.** A prior lock
  mechanism caused triple-injections. It was removed; every transition
  scrubs the lead from its current domain before injecting into the next, and the
  lead pointer is the single source of truth for where it lives.

- **[DECISION] Read always filters at the database; hot-path metrics use
  write-side aggregators.** Driven by the 2026-05-19 Firestore quota incident —
  `getAllConversations(phone)` was listing the whole messages collection and
  filtering in memory, which exhausted the daily read quota under normal morning
  traffic and 500'd the app. Every request path now uses a `where` filter, a
  write-side aggregator/marker, or a single keyed `db.get`; a `list()` tripwire
  warns above 500 docs. "Texts sent (unique recipients)" and "Unique guests"
  became dedicated write-side index collections.

- **[DECISION] Hot-path counters are atomic, reserve-before-act.** The global
  daily cap and per-phone rate limit are reserved in a Firestore transaction
  *before* the Bland send and released if it fails, so the cap is never
  overshot and a transient error never locks a phone. The report's once-per-day
  send uses a transactional `claimReportDay` CAS so concurrent fires (Deploy
  retries) email exactly once.

- **[DECISION] "Answered" = Appointments campaign + duration gate, not raw
  disposition.** The answered metric counts a distinct phone in the call-log
  REPORT campaign id **81** (NOT the inject channel code `cuCyA6Xoeu88` — the
  call-log filter silently ignores the inject code) whose call was either a
  non-No-Answer disposition ≥ 60s, or a "No Answer" that ran ≥ 180s (a long
  No-Answer is a mis-disposition; we count the connect but keep the disposition
  string verbatim). An earlier draft's "answered in the thousands" was an
  artifact of the wrong id returning all campaigns; true lifetime answered ≈ 157.

- **[DECISION] Sale = a Quickbase booking within 7 days of a fired appointment.**
  The daily sale-match pulls today's QB report and writes a `saleswithin7d` +
  `guestactivated` marker for any phone whose `scheduledinjection` fired within
  the last 7 days. Activation dedup is transactional. Sales outside the window
  land in `salesoutsidewindow` and can be manually claimed by the operator.

- **[DECISION] The nightly report fires at 6:15 AM ET, after the morning
  pulls.** It used to fire at 4:15 AM, which left "answered" and "bookings"
  empty because the sale-match (09:00 UTC) and ReadyMode pull (09:30 UTC) hadn't
  run. It leads with a Yesterday funnel (SMS sent → calls scheduled → calls
  answered → bookings) over WTD/lifetime totals, and flags answered/bookings as
  ⚠ unverified when the feeding pull didn't run+succeed that morning. `?force=1`
  test-sends past the kill-switch without stamping the once-per-day marker.

- **[DECISION] TZ-naive appointment times are rejected at every write site.**
  After repeated incidents where a naive `eventTime` fired ~4h early in EDT,
  `scheduleInjection` throws on any time missing a `Z`/`±HH:MM` marker, and every
  write path normalizes through `normalizeAppointmentTime` first. Booking-scan
  reads from Firestore (one `where`), skips bot-generated `appt_` callIds and
  stale (>24h past) signals, and proposes nothing rather than re-anchoring a
  time-only match to today.

- **[DECISION] Webhooks return real error codes (502/400), not silent 200s.**
  The June 2026 hardening flipped `/sms-callback/{disposition,stop,talk-now,
  return-to-source,conversation}` and `/trigger/manual` to return 502/400 on
  internal failure so Bland/ReadyMode retry or alert. Local DNC opt-out is still
  recorded *before* any 502, so a guest is suppressed regardless. The
  ReadyMode inject verdict now honors the response **body** over the HTTP code,
  because RM returns HTTP 200 with `Accepted:false` for an unrecognized field —
  which previously phantom-succeeded.

- **[DECISION] Firebase auth, derived secret, fail-open-to-public on missing
  key.** Google sign-in restricted to the `monsterrg.com` domain; ID tokens
  verified locally (no per-request network call); session cookie HMAC secret
  derived deterministically from the service-account private key (survives
  deploys, nothing to manage). If `AUTH_FIREBASE_API_KEY` is unset, auth is
  disabled and every route public — a typo can never lock the team out, but a
  missing var silently un-protects the dashboard, so it's checked per deploy.

- **[DECISION] A canary monitor, always-200, value-not-status.** Two
  bearer-authed endpoints the external Canary polls: `/canary/conversations`
  (today's send count, liveness floor) and `/canary/errors` (yesterday's
  persisted terminal errors, paged on >0). They return 200 on a real reading so
  the watched value signals the problem; a non-2xx is Canary's down-detection.
  `CANARY_SECRET` fails closed if unset.

## Risks & honest limits

- **Talk-now and Cal-failed bookings under-store the transcript.** Talk-now
  writes the injection signal but not the SMS transcript (the exchange lives in
  Bland); Cal.com booking failures are fail-safe but only loudly logged. The
  headline counts are unaffected (they come from injection/answered/sale data,
  not the transcript), but the conversation review view can be incomplete. An
  additive on-booking transcript pull + the nightly reseed are the backstops.
- **Counters use different event clocks.** Sends, bookings, calls, and sales
  each bucket by their own day, so a single day's `answered` can exceed its
  `scheduled`; the `answered ⊆ booked` invariant only holds lifetime.
- **Inbound Bland-send failures and ad-hoc injects are console-only.** They
  aren't persisted, so they don't surface in `/canary/errors` — a coverage gap
  (Deploy logs are ephemeral).
- **ReadyMode portal scrape is fragile.** It depends on a single bot session
  (single-session lockout drove a month of silent failures, now self-healed via
  a reactive takeover) and on RM's HTML/JSON shapes; creds resets must be applied
  in two places.
- **`calldispositions` is now Appointments-scoped going forward**, so a lead's
  "activated" drill-in shows only Appointments calls.
- **Deno Deploy logs are ephemeral**, so any signal that lives only in a log line
  (Cal-failed bookings, inbound send failures) is not durably queryable.

## Deferred / not done (intent only — no stories for these)

- Cal.com inbound webhook receiver (Cal.com → us) — not built; we initiate
  bookings.
- Emulator tests (`tests/emulator/*`) — never built; all tests are unit + mocked.
- MostRecentPackage QB fields (booking-detail join on the Packages table) —
  return empty strings.
- Persisting inbound-send / ad-hoc-inject terminal failures (closes the
  `/canary/errors` coverage gap) — deferred, a hot-path change.
- Durable `calBookingFailed` flag on the scheduledinjection — planned.
- The shape-checker endgame: relocate Fresh → `frontend/`, flip the Deno Deploy
  entrypoint, delete the re-export shims.
- `QUICKBASE_FAIL_OPEN` env var is read but never consulted (fail-open is
  hardcoded) — either wire or delete.

## Verdict

Shipped, in production, and load-bearing for Monster's revenue funnel. The
architecture is sound and the safety posture is hard-won: two production
incidents (the Firestore quota blowout and the sweep outage) drove a
defense-in-depth stack — bounded reads, atomic counters, a paused-by-default
sweep, cron-health markers, and a canary monitor — and a 42-bug correctness
sweep hardened the webhook and counting paths. The honest gaps are
observability (ephemeral logs, console-only failures) and transcript
completeness on the direct-injection paths, both with named backstops. The
recommended next investments are durable error persistence and finishing the
`src/` canonical migration.
