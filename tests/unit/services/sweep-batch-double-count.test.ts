// Guards the sweep's per-phone error double-count guard. When a dial throws
// (status='error') the phone is recorded as ONE error. The atomic
// injectionhistory-write + scheduledinjection-delete then goes through ONE
// client.batch(); if THAT batch also fails, the guard at inj-sweep
// (`if (status !== "error")`) must NOT push a second error entry for the same
// phone. This pins that an error-status phone whose batch write also fails
// yields exactly ONE error in the result — distinct from the success-status
// transient-batch retry path covered by sweep-transient-batch-error.test.ts.

import { assert, assertEquals } from "@std/assert";
import {
  injectionHistoryCollection,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  type ListOptions,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { sweepScheduledInjections } from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const PHONE = "5551235300";

Deno.test("sweep: a dial that errors AND a failing batch write count exactly ONE error (no double-count)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // A due scheduledinjection.
    mock.docs.set(scheduledInjectionDocPath(PHONE), {
      phone: PHONE,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });

    // Force handleDelayedInjection to THROW (→ status='error') without any
    // network: make the dedup-guard read of the injectionhistory collection
    // reject. The sweep's own due-docs query (on scheduledinjections) must
    // still succeed, so only the injectionhistory list throws.
    const origList = mock.list.bind(mock);
    mock.list = (parentPath: string, opts: ListOptions = {}) => {
      if (parentPath === injectionHistoryCollection) {
        return Promise.reject(new Error("dedup read failed (transient)"));
      }
      return origList(parentPath, opts);
    };

    // AND make the per-phone batch write fail too.
    mock.batch = (_ops: BatchOp[]) =>
      Promise.reject(new Error("batch failed (transient)"));

    const r = await sweepScheduledInjections("cron", mock);
    assertEquals(r.scanned, 1, "the due doc was considered");
    assertEquals(
      r.errors.length,
      1,
      "an error-status phone whose batch ALSO fails must count exactly once",
    );
    assertEquals(r.errors[0].phone, PHONE);
    // The dial error (not the batch error) is the recorded reason — it was
    // pushed first and the batch path's guard suppressed the duplicate.
    assert(
      r.errors[0].error.includes("dedup read failed"),
      `the first (dial) error must be the recorded one; got: ${
        r.errors[0].error
      }`,
    );
    // delay-not-loss: the doc survives for the next sweep.
    assert(
      await mock.get(scheduledInjectionDocPath(PHONE)),
      "the scheduledinjection must survive the batch failure",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
