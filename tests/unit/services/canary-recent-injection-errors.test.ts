// Guards the near-real-time injection-failure feed that backs /canary/injections
// (the signal an external canary polls to TEXT on injection failures). Verifies:
//   - only status="error" docs are counted (success/skipped excluded),
//   - only failures INSIDE the rolling lookback window are counted,
//   - newest-first ordering.

import { assertEquals } from "@std/assert";
import { injectionHistoryDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { gatherRecentInjectionErrors } from "@shared/services/canary/errors.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("gatherRecentInjectionErrors: counts only recent terminal errors, newest first", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const now = new Date("2026-06-30T12:00:00.000Z");
    const minsAgo = (m: number) =>
      new Date(now.getTime() - m * 60_000).toISOString();

    // Inside the 120-min window, errors → counted.
    mock.docs.set(injectionHistoryDocPath("5550000001__a"), {
      phone: "5550000001",
      firedAt: minsAgo(10),
      status: "error",
      error: "ODR injection failed: boom",
      firedBy: "cron",
    });
    mock.docs.set(injectionHistoryDocPath("5550000002__b"), {
      phone: "5550000002",
      firedAt: minsAgo(90),
      status: "error",
      error: "still failing",
      firedBy: "cron",
    });
    // Outside the window (3h ago) → excluded.
    mock.docs.set(injectionHistoryDocPath("5550000003__c"), {
      phone: "5550000003",
      firedAt: minsAgo(180),
      status: "error",
      firedBy: "cron",
    });
    // Recent but NOT an error → excluded by the status filter.
    mock.docs.set(injectionHistoryDocPath("5550000004__d"), {
      phone: "5550000004",
      firedAt: minsAgo(5),
      status: "success",
      firedBy: "cron",
    });

    const r = await gatherRecentInjectionErrors(120, mock, now);
    assertEquals(r.lookbackMinutes, 120);
    assertEquals(r.totalErrors, 2, "only the two in-window errors count");
    // Newest first: the 10-min-ago failure leads.
    assertEquals(r.errors[0].phone, "5550000001");
    assertEquals(r.errors[1].phone, "5550000002");
  } finally {
    setFirestoreClientForTests(null);
  }
});
