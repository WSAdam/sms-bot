# Firestore Safety — Plan and Status

Context: see `incident-2026-05-19.md`. On 2026-05-19 we exhausted our daily
Firestore read quota mid-morning. Root cause was a query that read the whole
`conversations` collection on every inbound webhook to find one phone's history.
The collection grew large enough that this daily cost crossed the cap.

**All three parts done.** Every previously-unbounded scan now uses a
database-side `where` filter, a write-side aggregator, or a single-doc get. The
safety rail in `wrapper.list()` stays as a tripwire for future regressions. The
codebase has zero call sites that scan a full collection on a request path.

---

## A. Hot-path fix — DONE (this commit)

**What changed:** `getAllConversations(phone)` now asks Firestore to filter by
`phoneNumber` instead of listing every document and filtering in memory. Cost
per call drops from "size of the whole table" to "messages belonging to that
phone" (typically a few dozen).

**Why this alone matters:** this lookup runs on every `/trigger/readymode`
webhook — twice (opt-out check + history fetch). It was the dominant cost source
on the day of the incident.

**Regression guard:** unit test asserts the lookup passes a `phoneNumber`
equality filter to the database. If anyone ever reverts to the list-everything
pattern, the test fails.

---

## B. Convert the remaining full-collection scans — DONE

Every site that used to scan a full collection now does one of three things:

1. **Database-side `where` filter** (single-field auto-indexed or covered by a
   composite index in `firestore.indexes.json`):
   - `shared/services/conversations/store.ts` — `getAllConversations`,
     `deleteConversations`, `deleteConversationsByCallId`
   - `shared/services/conversations/reseed.ts` — `getCurrentMessagesForCall`
     (`where(callId)`)
   - `shared/services/orchestrator/service.ts` — `getEvents` (`where(phone)`,
     plus `logEvent` now stamps `phone` as a field)
   - `shared/services/injections/sweep.ts` —
     `where("eventTime", "<=", now) + orderBy + limit 50`
   - `shared/services/conversations/booking-scan.ts` — per-conversation
     `where(recoveredFromCallId)` + per-phone `db.get(guestactivated)` instead
     of two full pre-loads
   - `routes/api/dashboard/drill.ts` — composite indexes on (sender |
     phoneNumber | nodeTag, timestamp desc); most-selective filter applied
     database-side, remaining filters client-side on the small result set
   - `routes/api/admin/repopulate-injections.ts` —
     `where("nodeTag", "==", "appointment scheduled")` + per-phone
     fired-injection lookup
   - `routes/api/audit/browse.ts` — `orderBy(processedAt desc) + limit`
   - `routes/api/appointments.ts` — `orderBy(firedAt desc) + limit` on
     injectionhistory; bounded list on scheduledinjections (always small)

2. **Write-side aggregator / counter** (one doc per phone or per day, updated
   transactionally at write time, read cheaply at report time):
   - `sms-bot/injectedphones/byPhone/{phone10}` — single-doc marker replacing
     the full-table scan in `/api/guests/answered`. Backfill:
     `scripts/backfill-injected-phones.ts`.
   - `sms-bot/uniqueguestsbyphone/byPhone/{phone10}` — per-phone summary
     (firstSeen, lastSeen, messageCount, replyCount, hasReplied) updated
     transactionally in `storeMessage`. Powers `/api/guests/list`. Backfill:
     `scripts/backfill-unique-guests.ts`.
   - `sms-bot/metrics/daily/{YYYY-MM-DD}` + `sms-bot/metrics/lifetime/totals` —
     `apptsBooked` / `activations` / `textsSent` counters incremented atomically
     at write time (in `scheduleInjection`, `processSaleMatches`, and
     `recordOutboundRecipientMarkers`). The nightly report reads the rollup docs
     instead of scanning. Backfill: `scripts/backfill-daily-metrics.ts`.
   - `sms-bot/uniquerecipientbyphone/byPhone/{phone10}` and
     `sms-bot/weeklyrecipientbyphoneweek/byKey/{weekKey}__{phone10}` — the
     original Texts-Sent write-side markers (pre-existing).

3. **Removed entirely** — `routes/api/sales/claim-outside-window.ts` used to do
   4 × 50_000-limit scans just to compute a before/after diagnostic count for
   the UI. Replaced with single-doc presence checks
   (`preActivated`/`postActivated`) which carry the meaningful signal at ~1% of
   the cost.

### Carve-out: `shared/services/sale-match/service.ts`

This is the one place where the "filter at the database" rule does NOT apply.
Sale-match runs once a day against QB report 678, which returns ~30k+ rows on a
typical day. Per-phone Firestore lookups (`db.get` × 3 per row) would do ~90k
sequential reads on Deno Deploy and time out mid-flight — Adam hit this on
2026-05-22 and it surfaced as a 502 BOOT_FAILED.

Sale-match instead **bulk-loads** the three source collections
(scheduledinjections, injectionhistory, guestactivated) in parallel, once per
run, with `limit: 100_000`. Three lists × a few thousand docs each = a few
thousand reads total, finishes in ~1 second. The wrapper tripwire would fire on
this — explicit `limit: 100_000` is the signal that this site has been audited
and the trade-off is intentional.

When the rule does and doesn't apply:

| Pattern                                                         | Allowed scan?                            | Why                                                                                          |
| --------------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------- |
| Per-webhook (e.g. `/trigger/readymode`, `/api/guests/answered`) | ❌ never                                 | Cost scales with table size × webhook rate. This is the May 19 incident shape.               |
| Per-page-load (dashboard, drill-ins)                            | ❌ never                                 | Same shape as webhooks; humans refresh, scans compound.                                      |
| Once-a-day cron against bounded collections                     | ✅ allowed when N(input) ≫ N(collection) | sale-match. The break-even is when per-phone lookups would do more reads than a single scan. |
| Backfill scripts                                                | ✅ always                                | They exist to read the world once. Set `FIRESTORE_LIST_WARN_THRESHOLD` to silence the rail.  |

The break-even rule: if the input set is larger than the collection you'd be
filtering, bulk-scan. Otherwise per-phone. For sale-match (30k input rows vs ~3k
source-collection rows), bulk wins 10×. For the dashboard (50 docs/page input vs
20k conversations source), per-phone via composite index wins 400×.

### Composite index management

`firestore.indexes.json` at repo root defines the composite indexes required for
the new query shapes. To deploy:

```bash
gcloud firestore indexes composite create \
  --collection-group=messages \
  --field-config field-path=phoneNumber,order=ascending \
  --field-config field-path=timestamp,order=descending
# …repeat for each index in firestore.indexes.json
```

Or, with the Firebase CLI configured for the project:

```bash
firebase deploy --only firestore:indexes
```

Index builds run in the background (minutes-to-hours depending on collection
size). Code that depends on a composite index will return a
`9 FAILED_PRECONDITION: The query requires an index` error until the build
completes — deploy the indexes BEFORE the code that uses them.

### Sequencing rules (write-side aggregators)

Each aggregator/marker collection needs a one-shot backfill before the read-side
code change ships, otherwise historical phones with no future write become
invisible:

| Collection                                    | Backfill script                          | Read site              |
| --------------------------------------------- | ---------------------------------------- | ---------------------- |
| `injectedphones/byPhone`                      | `scripts/backfill-injected-phones.ts`    | `/api/guests/answered` |
| `uniqueguestsbyphone/byPhone`                 | `scripts/backfill-unique-guests.ts`      | `/api/guests/list`     |
| `metrics/daily/*` + `metrics/lifetime/totals` | `scripts/backfill-daily-metrics.ts`      | `/api/report/nightly`  |
| `orchestratorevents.phone` field              | `scripts/backfill-orchestrator-phone.ts` | `getEvents()`          |

Each backfill is idempotent — safe to re-run. Bump the
`FIRESTORE_LIST_WARN_THRESHOLD` env when running, since they intentionally scan
full collections.

---

## C. Safety rail — DONE

`shared/firestore/wrapper.ts` `list()` now logs a stack-trace warning when a
single call returns more than `FIRESTORE_LIST_WARN_THRESHOLD` docs (default
500). The warning includes the path, where-clause, and requested limit, plus the
calling stack. Threshold matches the historical default limit, so any call
returning above it is a strong signal to convert to a targeted query.

Implementation notes:

- Warning fires on the _returned_ size, not the requested limit — cost is what
  was actually paid, not what was asked for.
- Non-throwing by design: we never want this guard to take down a request path.
  Surfacing the call site in logs is enough.
- Override the threshold via env (`FIRESTORE_LIST_WARN_THRESHOLD`) only for
  one-off migration scripts that are intentionally large-scan. Production code
  should rewrite the query, not bump the threshold.

---

## Operational note

Firestore monitoring already shows this query's cost climbing for two weeks
before May 19. The signal was there. As part of B/C work, add the Firestore
"Read operations" dashboard to whatever rotation reviews infrastructure health
weekly.
