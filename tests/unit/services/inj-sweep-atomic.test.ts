// Guards the atomicity fix for the injection sweep. sweepScheduledInjections
// used to write the injectionhistory entry and then SEPARATELY delete the
// scheduledinjection — a delete failing after the set re-fired the injection on
// the next sweep (duplicate dial). The two ops now go through ONE client.batch()
// so they're all-or-nothing.
//
// To keep the test offline we seed a RECENT injectionhistory entry so the
// dedup guard inside handleDelayedInjection short-circuits to {skipped} BEFORE
// any ReadyMode/Bland HTTP — the sweep still runs its history-write + delete.

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

Deno.test("sweep writes history + deletes scheduledinjection in a SINGLE batch (atomic)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);

  // Record the batch op-sets so we can assert the history-set and the
  // scheduledinjection-delete landed in the SAME batch call.
  const batchCalls: BatchOp[][] = [];
  const origBatch = mock.batch.bind(mock);
  mock.batch = (ops: BatchOp[]) => {
    batchCalls.push(ops);
    return origBatch(ops);
  };

  try {
    const phone = "5551238888";
    // Due scheduledinjection (eventTime in the past).
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });
    // Recent injectionhistory → dedup guard skips the dial (no HTTP).
    mock.docs.set(injectionHistoryDocPath(`${phone}__seed`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    const result = await sweepScheduledInjections("cron", mock);
    assertEquals(result.scanned, 1);

    // The scheduledinjection doc must be gone.
    assertEquals(await mock.get(scheduledInjectionDocPath(phone)), null);

    // A new injectionhistory entry for this sweep must exist (in addition to
    // the seed) — count entries for the phone.
    const history = await mock.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone },
    });
    assert(
      history.length >= 2,
      "expected the seed + the new sweep history doc",
    );

    // The history-set and the scheduledinjection-delete must be in ONE batch.
    const combined = batchCalls.find((ops) => {
      const hasSet = ops.some((o) =>
        o.type === "set" && o.path.includes("injectionhistory")
      );
      const hasDelete = ops.some((o) =>
        o.type === "delete" && o.path.includes("scheduledinjections")
      );
      return hasSet && hasDelete;
    });
    assert(
      combined !== undefined,
      "history-set and scheduledinjection-delete must share one atomic batch",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
