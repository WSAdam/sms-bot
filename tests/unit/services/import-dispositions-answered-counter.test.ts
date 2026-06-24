// Covers the write-side `answered` daily/lifetime counter added to
// importDailyDispositions. The tricky part is the re-import case: a later
// import that surfaces an EARLIER answered call must MOVE the day-bucketed
// count (not double it), while never touching the lifetime count for a phone
// already seen. See shared/services/readymode/import-dispositions.ts.

import { assertEquals } from "@std/assert";
import {
  callDispositionDocPath,
  guestAnsweredDocPath,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  importDailyDispositions,
  isAnsweredCall,
} from "@shared/services/readymode/import-dispositions.ts";
import type { DialerCallRow } from "@shared/services/readymode/portal-client.ts";
import { easternDateString } from "@shared/util/time.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function setup() {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  return db;
}

// Put a phone in the funnel so its answered call is counted (answered ⊆ booked).
function seedInFunnel(db: FirestoreMock, phone10: string) {
  db.docs.set(scheduledInjectionDocPath(phone10), {
    phone: phone10,
    eventTime: "2026-06-01T15:00:00.000Z",
    scheduledAt: 0,
  });
}

function row(
  phone10: string,
  callLogId: string,
  callTime: string,
  disposition = "Appointment",
  durationSecs = 120, // default: a real conversation (>= ANSWERED_MIN_SECONDS)
): DialerCallRow {
  return {
    phone10,
    agentName: "Agent",
    disposition,
    callType: null,
    callTime,
    durationSecs,
    recId: null,
    callLogId,
    domain: "monsterodr",
  };
}

function dailyAnswered(db: FirestoreMock, day: string): number {
  const doc = db.docs.get(metricsDailyDocPath(day));
  return typeof doc?.answered === "number" ? doc.answered as number : 0;
}

function lifetimeAnswered(db: FirestoreMock): number {
  const doc = db.docs.get(metricsLifetimeDocPath());
  return typeof doc?.answered === "number" ? doc.answered as number : 0;
}

const PHONE = "5551230001"; // not in EXCLUDED_REPORTING_PHONES
const T_D1 = "2026-06-10T18:00:00.000Z"; // 2pm ET on 2026-06-10
const T_D0 = "2026-06-09T18:00:00.000Z"; // 2pm ET on 2026-06-09 (earlier day)
const D1 = easternDateString(new Date(T_D1));
const D0 = easternDateString(new Date(T_D0));

Deno.test("answered counter: first-ever answer increments its day + lifetime", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  const s = await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  assertEquals(s.answeredUpserted, 1);
  assertEquals(dailyAnswered(db, D1), 1);
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("answered counter: re-import of the same call does not double-count", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  const s2 = await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  assertEquals(s2.answeredAlreadyEarlier, 1);
  assertEquals(s2.answeredUpserted, 0);
  assertEquals(dailyAnswered(db, D1), 1);
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("answered counter: an earlier answer on a prior day moves the count, not lifetime", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  // A later import surfaces an EARLIER answered call on the previous ET day.
  const s2 = await importDailyDispositions([row(PHONE, "c0", T_D0)]);
  assertEquals(s2.answeredUpserted, 1);
  assertEquals(dailyAnswered(db, D0), 1); // +1 on the new (earlier) day
  assertEquals(dailyAnswered(db, D1), 0); // −1 off the old day
  assertEquals(lifetimeAnswered(db), 1); // same phone — no new lifetime count
});

Deno.test("answered counter: an earlier answer on the SAME ET day does not churn the count", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  const tLate = "2026-06-10T20:00:00.000Z"; // 4pm ET 2026-06-10
  const tEarly = "2026-06-10T16:00:00.000Z"; // noon ET, same ET day (= D1)
  await importDailyDispositions([row(PHONE, "c1", tLate)]);
  const s2 = await importDailyDispositions([row(PHONE, "c0", tEarly)]);
  // The doc moves earlier (not the already-earlier short-circuit) but the ET
  // day is unchanged, so no per-day delta is applied.
  assertEquals(s2.answeredUpserted, 1);
  assertEquals(s2.answeredAlreadyEarlier, 0);
  assertEquals(dailyAnswered(db, D1), 1); // no +1/−1 churn
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("answered counter: moving off a never-counted (pre-counter) day clamps at 0", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  // Simulate a guestanswered doc written BEFORE this counter existed: the doc
  // exists with answeredAt on D1, but metrics/daily/D1.answered was never
  // incremented. A re-import then surfaces an earlier call on the prior day.
  db.docs.set(guestAnsweredDocPath(PHONE), {
    phone10: PHONE,
    answered: true,
    answeredAt: T_D1,
    source: "readymode-call-log",
  });
  const s = await importDailyDispositions([row(PHONE, "c0", T_D0)]);
  assertEquals(s.answeredUpserted, 1);
  assertEquals(dailyAnswered(db, D0), 1); // +1 on the new (earlier) day
  assertEquals(dailyAnswered(db, D1), 0); // clamped, NOT −1
});

Deno.test("answered counter: out-of-funnel phone is not counted", async () => {
  const db = setup();
  // PHONE is deliberately NOT seeded into the funnel.
  const s = await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  assertEquals(s.answeredOutOfSystemSkipped, 1);
  assertEquals(s.answeredUpserted, 0);
  assertEquals(dailyAnswered(db, D1), 0);
  assertEquals(lifetimeAnswered(db), 0);
});

Deno.test("answered counter: a no-answer disposition does not count", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  const s = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "ODR No Answer"),
  ]);
  assertEquals(s.answeredUpserted, 0);
  assertEquals(dailyAnswered(db, D1), 0);
  assertEquals(lifetimeAnswered(db), 0);
});

Deno.test("answered counter: a sub-60s call does NOT count (duration gate)", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  // Non-No-Answer disposition but only 45s of talk time → not a real answer.
  const s = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "Not interested", 45),
  ]);
  assertEquals(s.answeredUpserted, 0);
  assertEquals(dailyAnswered(db, D1), 0);
  assertEquals(lifetimeAnswered(db), 0);
});

Deno.test("answered counter: duration boundary is inclusive — 60s counts, 59s does not", async () => {
  const db1 = setup();
  seedInFunnel(db1, PHONE);
  const at60 = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "Appointment", 60),
  ]);
  assertEquals(at60.answeredUpserted, 1);
  assertEquals(dailyAnswered(db1, D1), 1);
  assertEquals(lifetimeAnswered(db1), 1);

  const db2 = setup();
  seedInFunnel(db2, PHONE);
  const at59 = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "Appointment", 59),
  ]);
  assertEquals(at59.answeredUpserted, 0);
  assertEquals(dailyAnswered(db2, D1), 0);
  assertEquals(lifetimeAnswered(db2), 0);
});

Deno.test("answered counter: a long (>= 180s) 'No Answer' now counts (mis-disposition override)", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  // A No-Answer that ran 21 minutes is almost always a mis-disposition — the
  // agent held a real conversation and fat-fingered the outcome. The override
  // reclassifies the CONNECT as answered (the disposition string is preserved).
  const s = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "No Answer", 1260),
  ]);
  assertEquals(s.answeredUpserted, 1);
  assertEquals(dailyAnswered(db, D1), 1);
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("answered counter: a short (< 180s) 'No Answer' still does NOT count", async () => {
  const db = setup();
  seedInFunnel(db, PHONE);
  // 120s clears the 60s normal floor but NOT the 180s No-Answer override — a
  // No-Answer this short stays a no-answer (the normal floor must not leak in).
  const s = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "ODR No Answer", 120),
  ]);
  assertEquals(s.answeredUpserted, 0);
  assertEquals(dailyAnswered(db, D1), 0);
  assertEquals(lifetimeAnswered(db), 0);
});

Deno.test("answered counter: No-Answer override boundary is inclusive — 180s counts, 179s does not", async () => {
  const db1 = setup();
  seedInFunnel(db1, PHONE);
  const at180 = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "No Answer", 180),
  ]);
  assertEquals(at180.answeredUpserted, 1);
  assertEquals(lifetimeAnswered(db1), 1);

  const db2 = setup();
  seedInFunnel(db2, PHONE);
  const at179 = await importDailyDispositions([
    row(PHONE, "c1", T_D1, "No Answer", 179),
  ]);
  assertEquals(at179.answeredUpserted, 0);
  assertEquals(lifetimeAnswered(db2), 0);
});

Deno.test("isAnsweredCall: gate contract (normal 60s floor, No-Answer 180s override, test never)", () => {
  // Normal disposition: 60s floor, inclusive.
  assertEquals(isAnsweredCall("Not interested", 60), true);
  assertEquals(isAnsweredCall("Not interested", 59), false);
  assertEquals(isAnsweredCall("Sale (MCC)", 3600), true);
  // No-Answer (and team-prefixed variants): 180s override, inclusive.
  assertEquals(isAnsweredCall("No Answer", 180), true);
  assertEquals(isAnsweredCall("No Answer", 179), false);
  assertEquals(isAnsweredCall("ODR No Answer", 1260), true);
  assertEquals(isAnsweredCall("2ND No Answer", 120), false);
  // Case/whitespace-insensitive.
  assertEquals(isAnsweredCall("  no answer  ", 200), true);
  // TEST never counts, regardless of duration.
  assertEquals(isAnsweredCall("TEST", 100000), false);
  assertEquals(isAnsweredCall("test", 100000), false);
});

Deno.test("answered counter: requireInFunnel=false counts a phone NOT in the funnel", async () => {
  const db = setup();
  // PHONE deliberately NOT seeded — a campaign-restricted pull guarantees the
  // row is one of our leads, so the funnel gate is bypassed.
  const s = await importDailyDispositions(
    [row(PHONE, "c1", T_D1, "Not interested", 200)],
    { requireInFunnel: false },
  );
  assertEquals(s.answeredOutOfSystemSkipped, 0);
  assertEquals(s.answeredUpserted, 1);
  assertEquals(dailyAnswered(db, D1), 1);
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("answered counter: a successful increment CLEARS a stale answeredCounterFailedAt flag", async () => {
  // A PRIOR run's counter write failed and stamped answeredCounterFailedAt on
  // the day's metrics doc; nightly reads that flag and forces
  // ydAnsweredReliable=false. A LATER run that increments the counter correctly
  // must clear the flag — otherwise the answered stat is permanently (and
  // wrongly) reported "unreliable".
  const db = setup();
  seedInFunnel(db, PHONE);
  // Simulate the prior failure: the day doc carries the failure flag as a string.
  db.docs.set(metricsDailyDocPath(D1), {
    answeredCounterFailedAt: "2026-06-09T00:00:00.000Z",
  });
  await importDailyDispositions([row(PHONE, "c1", T_D1)]);
  // The counter incremented...
  assertEquals(dailyAnswered(db, D1), 1);
  // ...and the stale flag is no longer a string (nightly's `typeof === "string"`
  // demotion check now reads it as cleared).
  const day = db.docs.get(metricsDailyDocPath(D1));
  assertEquals(typeof day?.answeredCounterFailedAt === "string", false);
});

Deno.test("disposition encoding: guestanswered stores the SAME decoded disposition as calldisposition", async () => {
  // Pre-fix, calldisposition stored the HTML-DECODED disposition while
  // guestanswered stored the RAW entity string — the same call carried two
  // different disposition strings ("⇒ Agent" vs "&rArr; Agent") across the two
  // docs, breaking audits/exports/comparisons. Both must now be decoded.
  const db = setup();
  seedInFunnel(db, PHONE);
  await importDailyDispositions([
    row(PHONE, "cEnc", T_D1, "&rArr; Andrew Torsiello", 200),
  ]);
  const callDispo = db.docs.get(callDispositionDocPath(PHONE, "cEnc"));
  const guestAnswered = db.docs.get(guestAnsweredDocPath(PHONE));
  assertEquals(callDispo?.disposition, "⇒ Andrew Torsiello");
  assertEquals(guestAnswered?.lastDisposition, "⇒ Andrew Torsiello");
  // And critically — they MATCH (no raw-vs-decoded drift).
  assertEquals(guestAnswered?.lastDisposition, callDispo?.disposition);
});
