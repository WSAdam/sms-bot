// Guards recordCronRun's "marker is observability, never a reason to fail a
// cron run" contract. recordCronRun runs the wrapped fn, then stamps a heartbeat
// marker doc. If that marker write FAILS (Firestore unreachable), it must log a
// warning and STILL return the wrapped fn's result — never abort the run on a
// marker blip. cron-marker-skipped covers the status mapping; this pins the
// marker-write-failure resilience itself.

import { assert, assertEquals } from "@std/assert";
import { recordCronRun } from "@scheduling/domain/data/cron-marker/mod.ts";
import {
  type FirestoreClient,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

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

Deno.test("recordCronRun: a marker-write failure logs a warning and still returns the wrapped result (does not re-throw)", async () => {
  const mock = new FirestoreMock();
  // Make ONLY the marker write fail; everything else behaves normally.
  mock.set = () =>
    Promise.reject(new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"));
  setFirestoreClientForTests(mock);
  try {
    let result:
      | { scanned: number; fired: number; errors: unknown[] }
      | undefined;
    const warnings = await captureWarn(async () => {
      result = await recordCronRun("scheduled-injection-sweep-v2", async () => {
        // A normal sweep that did real work.
        return await Promise.resolve({ scanned: 10, fired: 10, errors: [] });
      });
    });

    // The wrapped result is preserved — the marker blip did not abort the run.
    assertEquals(
      result,
      { scanned: 10, fired: 10, errors: [] },
      "the wrapped fn's result must survive a marker-write failure",
    );
    // And the failure is observable in the logs.
    assert(
      warnings.some((w) =>
        w.includes("marker write failed") &&
        w.includes("scheduled-injection-sweep-v2")
      ),
      `a marker-write failure must be logged; got: ${warnings.join(" | ")}`,
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordCronRun: a marker-write failure does NOT mask a wrapped-fn error (the fn error still wins)", async () => {
  const mock = new FirestoreMock();
  mock.set = () => Promise.reject(new Error("marker write blip"));
  setFirestoreClientForTests(mock as unknown as FirestoreClient);
  try {
    let caught: Error | undefined;
    await captureWarn(async () => {
      try {
        await recordCronRun("test-cron", async () => {
          await Promise.resolve();
          throw new Error("real work failed");
        });
      } catch (e) {
        caught = e as Error;
      }
    });
    // The wrapped fn's error must surface — NOT the marker-write error.
    assertEquals(
      caught?.message,
      "real work failed",
      "the wrapped error wins; the marker-write failure is only logged",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});
