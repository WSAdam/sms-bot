// Unit tests for the answered backfill's pure logic + write properties.
// The script body is guarded by `import.meta.main`, so importing it here only
// pulls in the exported `bucketDay` / `runBackfill` (no Firestore, no Deno.args).

import { assertEquals } from "@std/assert";
import {
  metricsDailyDocPath,
  metricsLifetimeDocPath,
} from "@shared/firestore/paths.ts";
import type { ListResult } from "@shared/firestore/wrapper.ts";
import { bucketDay, runBackfill } from "@/scripts/backfill-daily-answered.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function ans(phone10: string, answeredAt: string): ListResult {
  return { id: phone10, data: { phone10, answered: true, answeredAt } };
}

function dailyAnswered(db: FirestoreMock, day: string): unknown {
  return db.docs.get(metricsDailyDocPath(day))?.answered;
}

function lifetimeAnswered(db: FirestoreMock): unknown {
  return db.docs.get(metricsLifetimeDocPath())?.answered;
}

const TODAY = "2026-06-12";

Deno.test("bucketDay: parses ISO strings + epoch ms, rejects junk", () => {
  assertEquals(bucketDay("2026-06-10T18:00:00.000Z"), "2026-06-10");
  assertEquals(
    bucketDay(new Date("2026-06-10T18:00:00.000Z").getTime()),
    "2026-06-10",
  );
  assertEquals(bucketDay(""), null);
  assertEquals(bucketDay("not-a-date"), null);
  assertEquals(bucketDay(null), null);
  assertEquals(bucketDay(undefined), null);
  assertEquals(bucketDay({}), null);
});

Deno.test("runBackfill: sets answered, preserves sibling counters, converges on re-run", async () => {
  const db = new FirestoreMock();
  const D = "2026-06-10";
  // A day that backfill-daily-metrics.ts already populated.
  db.docs.set(metricsDailyDocPath(D), {
    textsSent: 5,
    apptsBooked: 2,
    activations: 1,
  });
  const answered = [
    ans("5551110001", "2026-06-10T18:00:00.000Z"),
    ans("5551110002", "2026-06-10T19:00:00.000Z"),
    ans("5551110003", "2026-06-10T20:00:00.000Z"),
  ];

  await runBackfill(db, answered, { today: TODAY });

  const doc = db.docs.get(metricsDailyDocPath(D))!;
  assertEquals(doc.answered, 3);
  // setMerge, not set — the sibling counters survive.
  assertEquals(doc.textsSent, 5);
  assertEquals(doc.apptsBooked, 2);
  assertEquals(doc.activations, 1);
  assertEquals(lifetimeAnswered(db), 3);

  // Idempotent: re-running recomputes the canonical count, never accumulates.
  await runBackfill(db, answered, { today: TODAY });
  assertEquals(dailyAnswered(db, D), 3); // not 6
  assertEquals(lifetimeAnswered(db), 3);
});

Deno.test("runBackfill: excludes today's per-day merge but counts it in lifetime", async () => {
  const db = new FirestoreMock();
  const answered = [
    ans("5551110001", "2026-06-10T18:00:00.000Z"), // historical
    ans("5551110004", `${TODAY}T18:00:00.000Z`), // today — owned by live counter
  ];

  await runBackfill(db, answered, { today: TODAY });

  assertEquals(dailyAnswered(db, "2026-06-10"), 1);
  // Today's daily doc is NOT written — the live forward counter owns it.
  assertEquals(db.docs.get(metricsDailyDocPath(TODAY)), undefined);
  // Lifetime is the all-time total and still includes today.
  assertEquals(lifetimeAnswered(db), 2);
});

Deno.test("runBackfill: excluded test phones are skipped", async () => {
  const db = new FirestoreMock();
  const answered = [
    ans("5551110001", "2026-06-10T18:00:00.000Z"),
    ans("8432222986", "2026-06-10T19:00:00.000Z"), // Adam's test phone (excluded)
  ];

  const r = await runBackfill(db, answered, { today: TODAY });

  assertEquals(r.skippedExcluded, 1);
  assertEquals(dailyAnswered(db, "2026-06-10"), 1); // not 2
  assertEquals(lifetimeAnswered(db), 1);
});

Deno.test("runBackfill: dry-run computes totals but writes nothing", async () => {
  const db = new FirestoreMock();
  const answered = [ans("5551110001", "2026-06-10T18:00:00.000Z")];

  const r = await runBackfill(db, answered, { today: TODAY, dryRun: true });

  assertEquals(r.lifetime, 1);
  assertEquals(r.daysWritten, 0);
  assertEquals(db.size(), 0); // no writes at all
});
