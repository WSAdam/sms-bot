// Guards the activation double-count fix. Sale-match pre-loads guestActivated
// docs into a STALE snapshot at the start of a run, so two overlapping runs
// (daily cron + a manual activate-from-report) could both see a phone as
// not-yet-activated and both increment the activations counters. The fix gates
// each increment on a transactional claim (activationCounted) on the
// guestActivated doc, so the lifetime counter only moves once per phone.

import { assertEquals } from "@std/assert";
import {
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { easternDateString } from "@shared/util/time.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function seedPending(db: FirestoreMock, phone10: string, daysAgo: number) {
  const eventTime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    .toISOString();
  const inj: FutureInjection = {
    phone: phone10,
    eventTime,
    scheduledAt: Date.now(),
  };
  db.docs.set(scheduledInjectionDocPath(phone10), { ...inj });
}

Deno.test("sale-match: re-running for the same phone does NOT double-count activations", async () => {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    seedPending(db, "9999990001", 1);

    // First run activates the phone and increments the lifetime counter by 1.
    const r1 = await processSaleMatches([{ phone10: "9999990001" }]);
    assertEquals(r1.matched, 1);
    const afterFirst = await db.get(metricsLifetimeDocPath());
    assertEquals(afterFirst?.activations, 1);

    // Second run over the SAME phone (re-run / overlap). The guestActivated
    // doc now carries activationCounted:true, so the counter must NOT move.
    await processSaleMatches([{ phone10: "9999990001" }]);
    const afterSecond = await db.get(metricsLifetimeDocPath());
    assertEquals(
      afterSecond?.activations,
      1,
      "lifetime activations must stay at 1 — the phone was already counted",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("sale-match: CONCURRENT overlapping runs for the same phone count it exactly once", async () => {
  // The genuine race: two runs both bulk-load the (stale) guestActivated
  // snapshot before either commits, so both see the phone as not-activated and
  // both add it to newlyActivatedPhones. The transactional activationCounted
  // claim guarantees only ONE of them actually increments the counter.
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    seedPending(db, "9999990009", 1);
    await Promise.all([
      processSaleMatches([{ phone10: "9999990009" }]),
      processSaleMatches([{ phone10: "9999990009" }]),
    ]);
    const lifetime = await db.get(metricsLifetimeDocPath());
    assertEquals(
      lifetime?.activations,
      1,
      "overlapping runs must count the activation exactly once",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("sale-match: a successful activations increment CLEARS a stale activationsCounterFailedAt flag", async () => {
  // A PRIOR run's counter write failed and stamped activationsCounterFailedAt on
  // the sale-day metrics doc; nightly reads that flag and forces
  // ydBookingsReliable=false. A LATER run that increments the counter correctly
  // must clear the flag — otherwise the booking stat is permanently (and
  // wrongly) reported "unreliable".
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    // saleAt defaults to now → activations bucket on today's ET day.
    const saleDay = easternDateString(new Date());
    seedPending(db, "9999990050", 1);
    db.docs.set(metricsDailyDocPath(saleDay), {
      activationsCounterFailedAt: "2026-06-09T00:00:00.000Z",
    });

    const r = await processSaleMatches([{ phone10: "9999990050" }]);
    assertEquals(r.matched, 1);

    const day = db.docs.get(metricsDailyDocPath(saleDay));
    // The counter incremented...
    assertEquals(day?.activations, 1);
    // ...and the stale flag is no longer a string (nightly reads it as cleared).
    assertEquals(typeof day?.activationsCounterFailedAt === "string", false);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("sale-match: two distinct phones each count once", async () => {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    seedPending(db, "9999990002", 1);
    seedPending(db, "9999990003", 2);
    await processSaleMatches([
      { phone10: "9999990002" },
      { phone10: "9999990003" },
    ]);
    const lifetime = await db.get(metricsLifetimeDocPath());
    assertEquals(lifetime?.activations, 2);
  } finally {
    setFirestoreClientForTests(null);
  }
});
