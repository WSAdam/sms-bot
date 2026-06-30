// Guards the aggregator-write-failure observability for scheduleInjection. The
// apptsBooked per-day counter increment is fire-and-forget; if it fails
// (quota/network) the day's bookings counter silently drifts. The fix mirrors
// sale-match's *CounterFailedAt pattern: on failure we stamp
// apptsBookedCounterFailedAt on metrics/daily/{day} so the dashboard / nightly
// report can flag that day's bookings as possibly incomplete; on a clean write
// we clear the flag.

import { assert, assertEquals } from "@std/assert";
import {
  metricsDailyDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { scheduleInjection } from "@scheduling/domain/data/inj-schedule/mod.ts";
import { easternDateString } from "@shared/util/time.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const FUTURE = "2999-01-01T12:00:00.000Z"; // canonical UTC — passes the guard

Deno.test("scheduleInjection: an apptsBooked increment failure stamps apptsBookedCounterFailedAt on the day doc", async () => {
  const mock = new FirestoreMock();
  // Make the counter increment fail the way a quota/network blip would.
  mock.incrementField = () =>
    Promise.reject(new Error("RESOURCE_EXHAUSTED: quota"));
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551238500";
    await scheduleInjection(phone, FUTURE, false, undefined, mock);

    // The scheduledinjection itself still landed (the schedule never blocks on
    // the fire-and-forget aggregator).
    assert(
      await mock.get(scheduledInjectionDocPath(phone)),
      "the scheduledinjection must still be written",
    );

    // Wait for the fire-and-forget aggregator chain to settle.
    await new Promise((r) => setTimeout(r, 50));

    const day = easternDateString();
    const daily = await mock.get(metricsDailyDocPath(day));
    assert(daily, "the metrics/daily doc must exist with the failure flag");
    assertEquals(
      typeof daily.apptsBookedCounterFailedAt,
      "string",
      "a counter failure must stamp apptsBookedCounterFailedAt so the report can demote the day",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("scheduleInjection: a clean aggregator write clears any stale apptsBookedCounterFailedAt", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const day = easternDateString();
    // A prior failed run left the flag set.
    await mock.set(metricsDailyDocPath(day), {
      apptsBooked: 3,
      apptsBookedCounterFailedAt: "2026-06-29T00:00:00.000Z",
    });

    const phone = "5551238501";
    await scheduleInjection(phone, FUTURE, false, undefined, mock);
    await new Promise((r) => setTimeout(r, 50));

    const daily = await mock.get(metricsDailyDocPath(day));
    assert(daily, "daily doc exists");
    assertEquals(
      daily.apptsBookedCounterFailedAt,
      null,
      "a clean increment must clear the stale failure flag",
    );
    assertEquals(daily.apptsBooked, 4, "the counter still incremented");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("scheduleInjection: a failed flag-CLEAR write (success path) is logged, not silently swallowed", async () => {
  const mock = new FirestoreMock();
  // The increment succeeds, but the success-path flag CLEAR setMerge (the one
  // carrying apptsBookedCounterFailedAt) fails. Previously an empty
  // `.catch(() => {})` swallowed this, so a stale flag could persist forever
  // (permanently demoting ydBookingsReliable). The fix logs it.
  const origSetMerge = mock.setMerge.bind(mock);
  mock.setMerge = (path, data) => {
    if ("apptsBookedCounterFailedAt" in data) {
      return Promise.reject(new Error("flag-clear setMerge failed (blip)"));
    }
    return origSetMerge(path, data);
  };
  setFirestoreClientForTests(mock);

  const lines: string[] = [];
  const origWarn = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    const phone = "5551238502";
    await scheduleInjection(phone, FUTURE, false, undefined, mock);
    await new Promise((r) => setTimeout(r, 50));
    assert(
      lines.some((w) => w.includes("apptsBookedCounterFailedAt clear failed")),
      `a failed flag-clear write must be logged; got: ${lines.join(" | ")}`,
    );
  } finally {
    console.warn = origWarn;
    setFirestoreClientForTests(null);
  }
});
