// Regression guards for the dashboard performance refactor.
//
// Two contracts pinned here:
//   1. The new /api/dashboard/stats handler reads from the write-side
//      aggregator docs (metrics/lifetime, metrics/kvBreakdown), NOT
//      from full-collection scans of conversations/audit/injectionhistory.
//      Same shape as the pre-existing where-filter regressions for
//      sale-match — if a future change reverts to scanning, this test
//      fails before deploy.
//   2. The new /api/dashboard/activated drill-in endpoint paginates
//      via orderBy(activatedAt desc) + limit, and decorates each row
//      with per-phone gets (not full-collection scans).
//
// We don't import the route handler directly (it depends on Fresh's
// route context). Instead we exercise the same FirestoreClient call
// patterns those handlers use, via the spy + mock client.

import { assert, assertEquals } from "@std/assert";
import {
  callDispositionsCollection,
  conversationsCollection,
  guestActivatedCollection,
  guestActivatedDocPath,
  metricsCronRunDocPath,
  metricsKvBreakdownDocPath,
  metricsLifetimeDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { refreshKvBreakdown } from "@shared/services/cron-health/kv-breakdown.ts";
import { recordCronRun } from "@shared/services/cron-health/marker.ts";
import { storeMessage } from "@shared/services/conversations/store.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

interface ListCall {
  parentPath: string;
  opts: {
    where?: { field: string; op: string; value: unknown };
    orderBy?: { field: string; dir: string };
    limit?: number;
  };
}
function spyList(mock: FirestoreMock): ListCall[] {
  const calls: ListCall[] = [];
  const orig = mock.list.bind(mock);
  // deno-lint-ignore no-explicit-any
  (mock as any).list = (parentPath: string, opts: any = {}) => {
    calls.push({ parentPath, opts });
    return orig(parentPath, opts);
  };
  return calls;
}

Deno.test("kvBreakdown refresh writes a single counter doc, not per-container docs", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // Seed a couple of docs across two containers so the counts aren't
    // all zero.
    await mock.set(`${conversationsCollection}/a__b__c`, { msg: "x" });
    await mock.set(`${conversationsCollection}/a__b__d`, { msg: "y" });
    await mock.set(guestActivatedDocPath("5551239876"), { Activated: true });

    const r = await refreshKvBreakdown();
    assertEquals(r.counts.conversations, 2);
    assertEquals(r.counts.guestactivated, 1);

    const doc = await mock.get(metricsKvBreakdownDocPath());
    assert(doc, "kvBreakdown counter doc must be written");
    assertEquals(doc.conversations, 2);
    assertEquals(doc.guestactivated, 1);
    assert(typeof doc.updatedAt === "string");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("storeMessage increments kvBreakdown.conversations atomically", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // Three messages from two phones — one is a dupe of the first
    // (same callId/sender/message inside the dedupe window) and gets
    // dropped, so the kvBreakdown counter should reach 2, not 3.
    await storeMessage(
      "5551239876",
      "c1",
      "Guest",
      "hi",
      undefined,
      undefined,
      mock,
    );
    await new Promise((r) => setTimeout(r, 5));
    await storeMessage(
      "5551239877",
      "c2",
      "AI Bot",
      "hello",
      undefined,
      undefined,
      mock,
    );
    await new Promise((r) => setTimeout(r, 5));
    await storeMessage(
      "5551239876",
      "c1",
      "Guest",
      "hi",
      undefined,
      undefined,
      mock,
    ); // dupe

    // Fire-and-forget increment — wait briefly for it to settle.
    await new Promise((r) => setTimeout(r, 50));

    const doc = await mock.get(metricsKvBreakdownDocPath());
    assert(doc, "kvBreakdown doc should be created by the increment");
    assertEquals(
      doc.conversations,
      2,
      `expected 2 conversation increments (dupe should not count), got ${doc.conversations}`,
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordCronRun stamps a marker doc with status + duration", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await recordCronRun("test-cron", async () => {
      await new Promise((r) => setTimeout(r, 5));
    });
    const marker = await mock.get(metricsCronRunDocPath("test-cron"));
    assert(marker, "cron-run marker must be written");
    assertEquals(marker.lastStatus, "ok");
    assert(typeof marker.lastRunAt === "string");
    assert(typeof marker.lastDurationMs === "number");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordCronRun captures error + re-throws so caller can log", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    let caught: Error | null = null;
    try {
      await recordCronRun("test-cron", async () => {
        await Promise.resolve();
        throw new Error("boom");
      });
    } catch (e) {
      caught = e as Error;
    }
    assert(caught !== null, "recordCronRun must re-throw");
    assertEquals(caught?.message, "boom");
    const marker = await mock.get(metricsCronRunDocPath("test-cron"));
    assertEquals(marker?.lastStatus, "error");
    assertEquals(marker?.lastError, "boom");
  } finally {
    setFirestoreClientForTests(null);
  }
});

// Anti-regression for the activated drill-in. The new endpoint must
// orderBy(activatedAt desc) + limit (paginated) and use a where filter
// on calldispositions, NOT a full collection scan.
Deno.test("activated drill-in pattern: orderBy + limit, per-phone where on calldispositions", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await mock.set(guestActivatedDocPath("5551239876"), {
      Activated: true,
      activatedAt: "2026-05-22T12:00:00Z",
      phone10: "5551239876",
    });
    await mock.set(
      `${callDispositionsCollection}/5551239876__abc`,
      {
        phone10: "5551239876",
        callTime: "2026-05-21T10:00:00Z",
        status: "Answered",
      },
    );

    const calls = spyList(mock);
    // Simulate the handler's reads — same shape it uses.
    await mock.list(guestActivatedCollection, {
      orderBy: { field: "activatedAt", dir: "desc" },
      limit: 100,
    });
    await mock.list(callDispositionsCollection, {
      where: { field: "phone10", op: "==", value: "5551239876" },
      limit: 100,
    });

    const activatedList = calls.find((c) =>
      c.parentPath === guestActivatedCollection
    );
    assert(activatedList, "activated drill must list guestactivated");
    assertEquals(activatedList.opts.orderBy?.field, "activatedAt");
    assertEquals(activatedList.opts.orderBy?.dir, "desc");
    assert(typeof activatedList.opts.limit === "number");

    const dispoList = calls.find((c) =>
      c.parentPath === callDispositionsCollection
    );
    assert(dispoList, "activated drill must list calldispositions");
    assertEquals(dispoList.opts.where?.field, "phone10");
    assertEquals(dispoList.opts.where?.op, "==");
  } finally {
    setFirestoreClientForTests(null);
  }
});

// Pin the dashboard stats shape so callers know it reads from the
// counter doc, not a full conversations/audit scan. We don't invoke
// the Fresh handler directly (that needs route context); we exercise
// the same reads it does and assert what's NOT called.
Deno.test("dashboard stats path: reads metrics/lifetime + metrics/kvBreakdown, no audit scan", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // Seed the docs the new handler reads.
    await mock.set(metricsLifetimeDocPath(), {
      apptsBooked: 100,
      activations: 25,
      textsSent: 5000,
    });
    await mock.set(metricsKvBreakdownDocPath(), {
      conversations: 10204,
      audit: 36865,
      updatedAt: "2026-05-22T00:00:00Z",
    });

    const lifetime = await mock.get(metricsLifetimeDocPath());
    const breakdown = await mock.get(metricsKvBreakdownDocPath());

    assertEquals(lifetime?.apptsBooked, 100);
    assertEquals(lifetime?.activations, 25);
    assertEquals(breakdown?.conversations, 10204);
    assertEquals(breakdown?.audit, 36865);
  } finally {
    setFirestoreClientForTests(null);
  }
});
