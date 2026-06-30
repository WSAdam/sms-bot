// Guards observability of the sale-match failure-FLAG writes themselves. The
// outer try-catch around the activations counter increment stamps
// activationsCounterFailedAt on failure (and clears it on success) so the
// nightly report can demote ydBookingsReliable. But those flag setMerge writes
// used to end in an empty `.catch(() => {})`: if the flag-clear or flag-stamp
// write itself failed (quota/network), a stale flag would silently persist
// (permanently demoting that day) or a real failure would never be flagged —
// with nothing logged. The fix replaces the empty catches with logging ones.
// This test pins that a flag-write failure now surfaces as a warning.

import { assert } from "@std/assert";
import { metricsDailyDocPath } from "@shared/firestore/paths.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function seedDueInjection(db: FirestoreMock, phone10: string) {
  const inj: FutureInjection = {
    phone: phone10,
    eventTime: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(), // -1d
    scheduledAt: Date.now(),
  };
  db.docs.set(`sms-bot/scheduledinjections/byPhone/${phone10}`, { ...inj });
}

// Capture console.warn for the duration of fn.
async function captureWarn(fn: () => Promise<void>): Promise<string[]> {
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...args: unknown[]) => {
    lines.push(args.map(String).join(" "));
  };
  try {
    await fn();
  } finally {
    console.warn = orig;
  }
  return lines;
}

Deno.test("sale-match: a failed flag-CLEAR write (success path) is logged, not silently swallowed", async () => {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    seedDueInjection(db, "8888888001");
    // Let the increment succeed, but fail the success-path flag CLEAR write
    // (the setMerge carrying activationsCounterFailedAt: null).
    const origSetMerge = db.setMerge.bind(db);
    db.setMerge = (path, data) => {
      if ("activationsCounterFailedAt" in data) {
        return Promise.reject(new Error("flag-clear setMerge failed (blip)"));
      }
      return origSetMerge(path, data);
    };

    const warnings = await captureWarn(async () => {
      const r = await processSaleMatches([{ phone10: "8888888001" }]);
      assert(r.matched === 1, "the phone must match within window");
    });

    assert(
      warnings.some((w) =>
        w.includes("activationsCounterFailedAt clear failed")
      ),
      `a failed flag-clear write must be logged; got: ${warnings.join(" | ")}`,
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("sale-match: a failed flag-STAMP write (failure path) is logged, not silently swallowed", async () => {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    seedDueInjection(db, "8888888002");
    // Make the activations increment fail so the catch block runs, AND make the
    // flag-STAMP setMerge fail too — the residual gap this fix closes.
    const origInc = db.incrementField.bind(db);
    db.incrementField = (path, fields) => {
      if (typeof fields.activations === "number") {
        return Promise.reject(new Error("RESOURCE_EXHAUSTED: quota"));
      }
      return origInc(path, fields);
    };
    const origSetMerge = db.setMerge.bind(db);
    db.setMerge = (path, data) => {
      if ("activationsCounterFailedAt" in data) {
        return Promise.reject(new Error("flag-stamp setMerge failed (blip)"));
      }
      return origSetMerge(path, data);
    };

    const warnings = await captureWarn(async () => {
      const r = await processSaleMatches([{ phone10: "8888888002" }]);
      assert(r.matched === 1, "the phone must match within window");
    });

    // Two warnings expected: the increment-failed warning AND the flag-stamp
    // warning. We assert the flag-stamp one specifically (the new behavior).
    assert(
      warnings.some((w) =>
        w.includes("activationsCounterFailedAt stamp failed")
      ),
      `a failed flag-stamp write must be logged; got: ${warnings.join(" | ")}`,
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

// Sanity: confirm the daily doc path the flags target is stable (guards the
// test against a path-helper drift).
Deno.test("sale-match flag-write test: metricsDailyDocPath is the daily metrics doc", () => {
  const p = metricsDailyDocPath("2026-06-14");
  assert(p.includes("2026-06-14"), "daily doc path must embed the ET day");
});
