# Firestore Safety — Plan and Status

Context: see `incident-2026-05-19.md`. On 2026-05-19 we exhausted our daily
Firestore read quota mid-morning. Root cause was a query that read the whole
`conversations` collection on every inbound webhook to find one phone's history.
The collection grew large enough that this daily cost crossed the cap.

This doc tracks the three-part remediation. **Parts A and C are done; Part B is
partially done (nightly report converted; other call sites remain).**

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

## B. Convert the remaining full-collection scans — PARTIAL

Other places still use the same "list everything, filter in memory" pattern.
None of these run on the per-webhook hot path, so they didn't cause the incident
on their own, but they will eventually if left alone.

### Done

- **Nightly report** (`shared/services/report/nightly.ts`). The old build path
  listed the entire conversations collection (limit 50_000) to compute "Texts
  Sent (unique recipients)" lifetime + WTD. Replaced with two write-side
  recipient marker collections:
  `sms-bot/uniquerecipientbyphone/byPhone/{phone10}` and
  `sms-bot/weeklyrecipientbyphoneweek/byKey/{weekKey}__{phone10}`. Both are
  populated by an idempotent `atomicCreate` in
  `shared/services/readymode/service.ts` → `recordOutboundRecipientMarkers`,
  called after a successful Bland send. The report's WTD query filters with
  `where("weekKey", "==",
  currentWeekKey)` so the scan is bounded to one week
  of recipients (hundreds), not the conversations table (tens of thousands).
  Historical recipients from before the deploy need
  `scripts/backfill-recipient-markers.ts --apply` to seed the lifetime
  collection from existing conversations data; without it the lifetime number
  starts at 0 and grows from there.

### Still to convert

- Nightly conversation reseed — pulls the whole conversations table once per
  Bland conversation per night.
- Booking-scan cron — pulls all of `injectionhistory` and `guestactivated` at
  start, then a doc-get per conversation.
- Dashboard "drill" endpoint — full conversations scan per page load.
- Guests list endpoint — full conversations scan per page load.
- Admin "repopulate injections" tool — full conversations scan when invoked.
- Nightly report's three remaining lists (`scheduledinjections`,
  `injectionhistory`, `guestactivated`) — smaller collections, lower priority,
  but apply the same write-side-aggregator pattern when convenient.

Same approach as A: filter at the database, not in memory. Where a `where`
filter doesn't fit cleanly, use a `documentId()` range query on the
slash-prefixed doc IDs, or move to a write-side aggregator (the pattern the
nightly report now uses).

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
