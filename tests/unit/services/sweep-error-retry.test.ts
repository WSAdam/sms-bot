// Guards the DELAY-NOT-LOSS retry behavior (2026-06-30). A dial that THROWS
// must NOT consume the appointment. Pre-fix, ANY sweep error wrote
// status="error" and deleted the scheduledinjection in one batch — a single
// missing-index throw silently lost the booking forever (incident
// 2026-06-24..30). Now the sweep keeps the doc and retries, bumping `attempts`,
// and only writes a terminal status="error" + delete after
// MAX_INJECTION_ATTEMPTS.
//
// Errors are forced offline by rejecting the lead-pointer read inside
// handleDelayedInjection (the dedup guard is fail-open, so it can't be used to
// force an error anymore).

import { assert, assertEquals } from "@std/assert";
import {
  injectionHistoryCollection,
  leadPointerDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  MAX_INJECTION_ATTEMPTS,
  sweepScheduledInjections,
} from "@scheduling/domain/business/inj-sweep/mod.ts";
import { _clearGatesConfigCache } from "@core/business/gates-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function failPointerRead(mock: FirestoreMock, phone: string) {
  const origGet = mock.get.bind(mock);
  mock.get = (path: string) => {
    if (path === leadPointerDocPath(phone)) {
      return Promise.reject(new Error("pointer read failed (transient)"));
    }
    return origGet(path);
  };
}

Deno.test("sweep: a dial error below the retry cap KEEPS the appointment (delay-not-loss)", async () => {
  _clearGatesConfigCache();
  const mock = new FirestoreMock();
  const phone = "5551239001";
  mock.docs.set(scheduledInjectionDocPath(phone), {
    phone,
    eventTime: "2020-01-01T00:00:00.000Z",
    scheduledAt: Date.now(),
  });
  failPointerRead(mock, phone);
  setFirestoreClientForTests(mock);

  try {
    const r = await sweepScheduledInjections("cron", mock);
    assertEquals(r.scanned, 1);
    assertEquals(r.fired, 0);
    assertEquals(r.retrying, 1, "the failed dial is queued for retry");
    assertEquals(r.errors.length, 0, "a retrying error is NOT terminal yet");

    // The appointment SURVIVES, with attempts bumped — never lost.
    const doc = await mock.get(scheduledInjectionDocPath(phone));
    assert(doc, "the scheduledinjection must survive a retryable error");
    assertEquals(doc!.attempts, 1);
    assert(typeof doc!.lastError === "string");

    // No injectionhistory written on a non-terminal retry.
    const history = await mock.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone },
    });
    assertEquals(history.length, 0, "no history doc until the sweep gives up");
  } finally {
    setFirestoreClientForTests(null);
    _clearGatesConfigCache();
  }
});

Deno.test("sweep: a dial error at the retry cap is TERMINAL (writes status=error + deletes doc)", async () => {
  _clearGatesConfigCache();
  const mock = new FirestoreMock();
  const phone = "5551239002";
  // Already exhausted retries — this attempt is the terminal one.
  mock.docs.set(scheduledInjectionDocPath(phone), {
    phone,
    eventTime: "2020-01-01T00:00:00.000Z",
    scheduledAt: Date.now(),
    attempts: MAX_INJECTION_ATTEMPTS - 1,
  });
  failPointerRead(mock, phone);
  setFirestoreClientForTests(mock);

  try {
    const r = await sweepScheduledInjections("cron", mock);
    assertEquals(r.scanned, 1);
    assertEquals(r.retrying, 0);
    assertEquals(
      r.errors.length,
      1,
      "exhausted retries → exactly one terminal error",
    );
    assertEquals(r.errors[0].phone, phone);

    // The doc is consumed only now, after the retries are spent.
    assertEquals(
      await mock.get(scheduledInjectionDocPath(phone)),
      null,
      "the scheduledinjection is deleted on terminal failure",
    );

    // A terminal status="error" history doc is written (canary alert watches these).
    const history = await mock.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone },
    });
    assertEquals(history.length, 1);
    assertEquals(history[0].data.status, "error");
    assertEquals(history[0].data.attempts, MAX_INJECTION_ATTEMPTS);
  } finally {
    setFirestoreClientForTests(null);
    _clearGatesConfigCache();
  }
});
