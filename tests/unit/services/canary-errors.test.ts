// Verifies the Canary errors endpoint's data layer: only persisted terminal
// failures from YESTERDAY (ET) are reported — injectionhistory status="error"
// plus cronruns lastStatus="error" — and successes / wrong-day / wrong-status
// records are excluded. Timestamps are derived from yesterdayEasternRange() so
// the test tracks the same window the service uses (DST quirk included).

import { assertEquals } from "@std/assert";
import {
  injectionHistoryCollection,
  metricsCronRunsCollection,
} from "@shared/firestore/paths.ts";
import { yesterdayEasternRange } from "@shared/services/conversations/booking-scan.ts";
import { gatherHardErrorsForYesterday } from "@shared/services/canary/errors.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const { fromIso, toIso } = yesterdayEasternRange();
const midYesterday = new Date(
  (Date.parse(fromIso) + Date.parse(toIso)) / 2,
).toISOString();
const beforeWindow = new Date(Date.parse(fromIso) - 86_400_000).toISOString();
// toIso is the exclusive upper bound (= "today"), so it must be excluded.
const atUpperBound = toIso;

Deno.test("gatherHardErrorsForYesterday: only yesterday's terminal errors", async () => {
  const mock = new FirestoreMock();

  // injectionhistory: one in-window error (kept), plus three that must drop.
  await mock.set(`${injectionHistoryCollection}/5551112222__a`, {
    phone: "5551112222",
    status: "error",
    error: "ODR injection failed: Retry Failed: http=500",
    firedAt: midYesterday,
    firedBy: "cron",
  });
  await mock.set(`${injectionHistoryCollection}/5553334444__b`, {
    phone: "5553334444",
    status: "success", // wrong status
    firedAt: midYesterday,
    firedBy: "cron",
  });
  await mock.set(`${injectionHistoryCollection}/5555556666__c`, {
    phone: "5555556666",
    status: "error",
    error: "older error",
    firedAt: beforeWindow, // wrong day (before)
    firedBy: "cron",
  });
  await mock.set(`${injectionHistoryCollection}/5557778888__d`, {
    phone: "5557778888",
    status: "error",
    error: "today's error",
    firedAt: atUpperBound, // wrong day (today / boundary excluded)
    firedBy: "cron",
  });

  // cronruns: one in-window crash (kept), plus an ok one and an old crash.
  await mock.set(`${metricsCronRunsCollection}/scheduled-injection-sweep-v2`, {
    lastRunAt: midYesterday,
    lastStatus: "error",
    lastDurationMs: 1200,
    lastError: "sweep boot failed",
  });
  await mock.set(`${metricsCronRunsCollection}/qb-sale-match`, {
    lastRunAt: midYesterday,
    lastStatus: "ok", // healthy run, excluded
    lastDurationMs: 800,
  });
  await mock.set(`${metricsCronRunsCollection}/booking-scan`, {
    lastRunAt: beforeWindow, // wrong day
    lastStatus: "error",
    lastDurationMs: 500,
    lastError: "old crash",
  });

  const report = await gatherHardErrorsForYesterday(mock);

  assertEquals(report.totalErrors, 2);
  assertEquals(report.window, { since: fromIso, until: toIso });

  const injection = report.errors.find((e) => e.source === "injection");
  const cron = report.errors.find((e) => e.source === "cron");
  assertEquals(injection?.phone, "5551112222");
  assertEquals(
    injection?.error,
    "ODR injection failed: Retry Failed: http=500",
  );
  assertEquals(cron?.cron, "scheduled-injection-sweep-v2");
  assertEquals(cron?.error, "sweep boot failed");
});

Deno.test("gatherHardErrorsForYesterday: clean day reports zero", async () => {
  const mock = new FirestoreMock();
  await mock.set(`${injectionHistoryCollection}/5551112222__ok`, {
    phone: "5551112222",
    status: "success",
    firedAt: midYesterday,
    firedBy: "cron",
  });

  const report = await gatherHardErrorsForYesterday(mock);
  assertEquals(report.totalErrors, 0);
  assertEquals(report.errors, []);
});
