# Firestore Safety — Plan and Status

Context: see `incident-2026-05-19.md`. On 2026-05-19 we exhausted our daily
Firestore read quota mid-morning. Root cause was a query that read the whole
`conversations` collection on every inbound webhook to find one phone's
history. The collection grew large enough that this daily cost crossed the cap.

This doc tracks the three-part remediation. **Part A is done in this commit.
B and C are tracked here so they don't fall on the floor.**

---

## A. Hot-path fix — DONE (this commit)

**What changed:** `getAllConversations(phone)` now asks Firestore to filter by
`phoneNumber` instead of listing every document and filtering in memory. Cost
per call drops from "size of the whole table" to "messages belonging to that
phone" (typically a few dozen).

**Why this alone matters:** this lookup runs on every `/trigger/readymode`
webhook — twice (opt-out check + history fetch). It was the dominant cost
source on the day of the incident.

**Regression guard:** unit test asserts the lookup passes a `phoneNumber`
equality filter to the database. If anyone ever reverts to the
list-everything pattern, the test fails.

---

## B. Convert the remaining full-collection scans — TODO

Other places still use the same "list everything, filter in memory" pattern.
None of these run on the per-webhook hot path, so they didn't cause the
incident on their own, but they will eventually if left alone.

Call sites to convert:

- Nightly conversation reseed — pulls the whole conversations table once
  per Bland conversation per night.
- Booking-scan cron — pulls all of `injectionhistory` and `guestactivated`
  at start, then a doc-get per conversation.
- Dashboard "drill" endpoint — full conversations scan per page load.
- Guests list endpoint — full conversations scan per page load.
- Admin "repopulate injections" tool — full conversations scan when invoked.
- Nightly report — lists the conversations collection during reporting.

Same approach as A: filter at the database, not in memory. Where a `where`
filter doesn't fit cleanly, use a `documentId()` range query on the
slash-prefixed doc IDs. Owner / timing TBD.

---

## C. Safety rail — TODO

Add a guard in the Firestore wrapper so any `list()` call that returns more
than some threshold (proposed: 500 docs) logs a warning with a stack trace.
Goal is to surface this pattern early the next time someone adds it, before
it grows into another incident.

Open questions for C:

- Threshold value — 500 is the old `limit` that the May 5 change moved away
  from, so it's a reasonable inflection point.
- Whether to warn on the request size (limit) or the actual returned size.
  Returned size is the real cost; limit is the intent.
- Whether to wire it to an alert in monitoring or just rely on logs.

---

## Operational note

Firestore monitoring already shows this query's cost climbing for two weeks
before May 19. The signal was there. As part of B/C work, add the Firestore
"Read operations" dashboard to whatever rotation reviews infrastructure
health weekly.
