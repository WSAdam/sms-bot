// Guards the sweep's transient-batch resilience. The atomic
// injectionhistory-write + scheduledinjection-delete goes through ONE
// client.batch(). If batch() throws (quota/network), the sweep catches + logs
// and the scheduledinjection doc stays for the next sweep — correct
// resilient behavior (delay-not-loss). This test verifies:
//   (a) a transient batch failure for one phone leaves ITS doc in place AND
//       does not prevent subsequent phones in the sequential loop from being
//       processed + deleted, and
//   (b) the surviving doc is retried successfully on the next sweep.
//
// Offline: a recent injectionhistory seed makes handleDelayedInjection's dedup
// guard short-circuit to {skipped} before any ReadyMode/Bland HTTP.

import { assert, assertEquals } from "@std/assert";
import {
  injectionHistoryCollection,
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { sweepScheduledInjections } from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const PHONE_A = "5551235200";
const PHONE_B = "5551235201";

function seedDue(mock: FirestoreMock, phone: string, eventTime: string) {
  mock.docs.set(scheduledInjectionDocPath(phone), {
    phone,
    eventTime,
    scheduledAt: Date.now(),
  });
  // Recent history → dedup guard skips the dial (keeps it offline).
  mock.docs.set(injectionHistoryDocPath(`${phone}__seed`), {
    phone,
    firedAt: new Date().toISOString(),
    status: "success",
  });
}

Deno.test("sweep: a transient batch() failure for phone A leaves A's doc and still processes B; A is retried next sweep", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // eventTime ordering: A is older so the sweep's asc orderBy processes A
    // first, then B.
    seedDue(mock, PHONE_A, "2020-01-01T00:00:00.000Z");
    seedDue(mock, PHONE_B, "2020-01-02T00:00:00.000Z");

    // Fail batch() only for the call that deletes A's scheduledinjection.
    const origBatch = mock.batch.bind(mock);
    let failA = true;
    mock.batch = (ops: BatchOp[]) => {
      const touchesA = ops.some((o) => o.path.includes(PHONE_A));
      if (touchesA && failA) {
        return Promise.reject(new Error("batch failed (transient)"));
      }
      return origBatch(ops);
    };

    const r1 = await sweepScheduledInjections("cron", mock);
    assertEquals(r1.scanned, 2);
    // A's batch threw → recorded as a per-phone error, doc survives.
    assertEquals(r1.errors.length, 1);
    assertEquals(r1.errors[0].phone, PHONE_A);
    assert(
      await mock.get(scheduledInjectionDocPath(PHONE_A)),
      "A's scheduledinjection must survive the batch failure (delay-not-loss)",
    );
    // B was NOT blocked by A's failure — it processed + deleted.
    assertEquals(
      await mock.get(scheduledInjectionDocPath(PHONE_B)),
      null,
      "B must process despite A's batch failure earlier in the loop",
    );

    // Next sweep with batch healthy: A is retried successfully and deleted.
    failA = false;
    const r2 = await sweepScheduledInjections("cron", mock);
    assertEquals(r2.scanned, 1, "only A remains due");
    assertEquals(r2.errors.length, 0);
    assertEquals(
      await mock.get(scheduledInjectionDocPath(PHONE_A)),
      null,
      "A must be drained once batch recovers",
    );
    const historyA = await mock.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: PHONE_A },
    });
    assert(
      historyA.length >= 2,
      "A's retried sweep must write a fresh injectionhistory entry (plus the seed)",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
