// Guards the sweep's per-phone error double-count guard on the TERMINAL error
// path. A dial that throws is now retried (delay-not-loss); only after
// MAX_INJECTION_ATTEMPTS does the sweep give up and write status="error" +
// delete in ONE client.batch(). If THAT terminal batch ALSO fails, the guard
// must NOT push a second error entry for the same phone — exactly ONE error.
//
// (Pre-2026-06-30 this test forced the error by making the dedup-guard read
// throw. That path is now FAIL-OPEN — a broken dedup query injects anyway
// instead of erroring — so we drive a real terminal error here: the dial fails
// on a pointer-read rejection AND the appointment has already exhausted its
// retries.)

import { assert, assertEquals } from "@std/assert";
import {
  leadPointerDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import {
  MAX_INJECTION_ATTEMPTS,
  sweepScheduledInjections,
} from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const PHONE = "5551235300";

Deno.test("sweep: a TERMINAL dial error whose batch ALSO fails counts exactly ONE error (no double-count) and keeps the doc", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    // A due scheduledinjection that has ALREADY exhausted its retries, so this
    // sweep is the terminal attempt (attempts -> MAX_INJECTION_ATTEMPTS).
    mock.docs.set(scheduledInjectionDocPath(PHONE), {
      phone: PHONE,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
      attempts: MAX_INJECTION_ATTEMPTS - 1,
    });

    // Force handleDelayedInjection to THROW without any network: reject the
    // lead-pointer read (the dedup guard is fail-open now, so it can't be used
    // to force an error — it would inject anyway). The sweep's own due-docs
    // query (a list on scheduledinjections) must still succeed.
    const origGet = mock.get.bind(mock);
    mock.get = (path: string) => {
      if (path === leadPointerDocPath(PHONE)) {
        return Promise.reject(new Error("pointer read failed (transient)"));
      }
      return origGet(path);
    };

    // AND make the per-phone terminal batch write fail too.
    mock.batch = (_ops: BatchOp[]) =>
      Promise.reject(new Error("batch failed (transient)"));

    const r = await sweepScheduledInjections("cron", mock);
    assertEquals(r.scanned, 1, "the due doc was considered");
    assertEquals(r.retrying, 0, "retries are exhausted — this is terminal");
    assertEquals(
      r.errors.length,
      1,
      "a terminal-error phone whose batch ALSO fails must count exactly once",
    );
    assertEquals(r.errors[0].phone, PHONE);
    assert(
      r.errors[0].error.includes("pointer read failed"),
      `the dial error (not the batch error) must be the recorded one; got: ${
        r.errors[0].error
      }`,
    );
    // delay-not-loss: the batch (and its delete) failed, so the doc survives.
    assert(
      await mock.get(scheduledInjectionDocPath(PHONE)),
      "the scheduledinjection must survive the terminal batch failure",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
