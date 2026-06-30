// Guards that the manual recovery routes (fireSingle / manual sweep) still
// respect the dedup guard. /api/cron/trigger-single → fireSingle(phone,
// "manual") and /api/cron/trigger → sweepScheduledInjections("manual") both
// bypass the cron gate but route through the SAME injection pipeline
// (handleDelayedInjection), whose dedup guard must still apply — an operator
// firing twice in quick succession (or manual + auto in one minute) must NOT
// double-dial; the second call skips on dedup.
//
// Offline: a recent injectionhistory seed makes the dedup guard short-circuit
// to {skipped} before any ReadyMode/Bland HTTP.

import { assert, assertEquals } from "@std/assert";
import {
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  fireSingle,
  sweepScheduledInjections,
} from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("fireSingle('manual'): a recent injectionhistory entry makes it skip (no double-dial)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551236300";
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });
    // A fire happened moments ago — within the 72h dedup window.
    mock.docs.set(injectionHistoryDocPath(`${phone}__recent`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    const r = await fireSingle(phone, "manual", mock);
    assertEquals(r.skipped, true, "fireSingle must respect the dedup guard");
    assertEquals(r.fired, false, "a deduped fire is not a successful dial");
    // The scheduledinjection is still drained (the doc has served its purpose).
    assertEquals(await mock.get(scheduledInjectionDocPath(phone)), null);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("manual sweep: a phone with a recent fire is counted as skipped, not fired", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551236301";
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });
    mock.docs.set(injectionHistoryDocPath(`${phone}__recent`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    const r = await sweepScheduledInjections("manual", mock);
    assertEquals(r.scanned, 1);
    assertEquals(
      r.fired,
      0,
      "manual sweep must not re-dial a recently-fired phone",
    );
    assertEquals(r.skipped, 1, "the recent fire must be deduped to skipped");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("manual + auto within the window: only the FIRST dial would fire, the SECOND dedups", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551236302";
    // Simulate the first dial already recorded (e.g. the auto sweep just ran),
    // then an operator manually fires the same phone in the same minute.
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });
    mock.docs.set(injectionHistoryDocPath(`${phone}__auto`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    const r = await fireSingle(phone, "manual", mock);
    assert(r.skipped, "the second (manual) fire in the window must dedup");
  } finally {
    setFirestoreClientForTests(null);
  }
});
