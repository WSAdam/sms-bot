// Guards the dedup-guard hardening (2026-06-30). The dedup guard is a SECONDARY
// check (avoid a rare double-dial); it must NEVER abort the PRIMARY injection.
// Two failure modes are pinned here:
//
//   1. FAIL-OPEN: if the dedup query itself throws (e.g. the missing
//      (phone, firedAt) composite index that silently consumed every booking
//      Jun 24–30 2026), handleDelayedInjection must INJECT anyway, not error.
//   2. IGNORE NON-SUCCESS: a prior injectionhistory doc with status "error" or
//      "skipped" means we NEVER actually dialed, so it must NOT suppress a real
//      dial. Only a prior status="success" within the window dedups.
//
// Offline: globalThis.fetch is stubbed so injectLead's ReadyMode POST "succeeds"
// without network.

import { assertEquals } from "@std/assert";
import { handleDelayedInjection } from "@sms-flow/domain/business/delayed-injection/mod.ts";
import {
  injectionHistoryCollection,
  injectionHistoryDocPath,
} from "@shared/firestore/paths.ts";
import {
  type ListOptions,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { _clearGatesConfigCache } from "@core/business/gates-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function withRmSuccess(fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    _clearGatesConfigCache();
    const original = globalThis.fetch;
    // RM accepts every lead-api call (preemptive scrub + the inject POST).
    globalThis.fetch = () =>
      Promise.resolve(new Response('{"Success":true}', { status: 200 }));
    try {
      await fn();
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
      _clearGatesConfigCache();
    }
  };
}

Deno.test(
  "dedup guard FAILS OPEN: a throwing dedup query injects anyway (does NOT error/skip)",
  withRmSuccess(async () => {
    const mock = new FirestoreMock();
    // Make the dedup read reject; everything else works.
    const origList = mock.list.bind(mock);
    mock.list = (parentPath: string, opts: ListOptions = {}) => {
      if (parentPath === injectionHistoryCollection) {
        return Promise.reject(new Error("requires an index (simulated)"));
      }
      return origList(parentPath, opts);
    };
    setFirestoreClientForTests(mock);

    const r = await handleDelayedInjection("9366762277");
    assertEquals(
      r,
      { skipped: false },
      "a broken dedup query must inject, not strand the appointment",
    );
  }),
);

Deno.test(
  "dedup guard IGNORES a recent status='error' doc (never dialed → must still inject)",
  withRmSuccess(async () => {
    const mock = new FirestoreMock();
    const phone = "9366760001";
    // A recent ERROR within the 72h window — represents a failed attempt that
    // never actually dialed. It must NOT poison the window.
    mock.docs.set(injectionHistoryDocPath(`${phone}__err`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "error",
    });
    setFirestoreClientForTests(mock);

    const r = await handleDelayedInjection(phone);
    assertEquals(
      r,
      { skipped: false },
      "a prior error (no real dial) must not suppress a real injection",
    );
  }),
);

Deno.test(
  "dedup guard IGNORES a recent status='skipped' doc (never dialed → must still inject)",
  withRmSuccess(async () => {
    const mock = new FirestoreMock();
    const phone = "9366760002";
    mock.docs.set(injectionHistoryDocPath(`${phone}__skip`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "skipped",
    });
    setFirestoreClientForTests(mock);

    const r = await handleDelayedInjection(phone);
    assertEquals(
      r,
      { skipped: false },
      "a prior dedup-skip (no real dial) must not suppress a real injection",
    );
  }),
);

Deno.test(
  "dedup guard STILL skips on a recent status='success' (a real prior dial)",
  withRmSuccess(async () => {
    const mock = new FirestoreMock();
    const phone = "9366760003";
    mock.docs.set(injectionHistoryDocPath(`${phone}__ok`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });
    setFirestoreClientForTests(mock);

    const r = await handleDelayedInjection(phone);
    assertEquals(r.skipped, true, "a real prior dial within the window dedups");
  }),
);
