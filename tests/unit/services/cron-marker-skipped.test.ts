// Guards the cron-marker "skipped" observability fix. recordCronRun used to
// stamp lastStatus:"ok" whenever the wrapped fn returned without throwing —
// even when the fn did NO work (a paused sweep gate, an already-sent report).
// The cron-health dashboard then showed GREEN/ok for a sweep doing nothing, so
// a safe-default disarm after a Firestore blip (incident 2026-06-29) looked
// identical to healthy operation. The fn can now call ctx.markSkipped(reason)
// to record lastStatus:"skipped" + skipReason instead.

import { assert, assertEquals } from "@std/assert";
import { recordCronRun } from "@scheduling/domain/data/cron-marker/mod.ts";
import { metricsCronRunDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("recordCronRun: a gate-disabled early return records lastStatus:'skipped' (+skipReason), not 'ok'", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await recordCronRun("scheduled-injection-sweep-v2", async (ctx) => {
      // Model main.ts's paused-sweep branch: the gate is off (a getGatesConfig
      // read), so we signal a skip and return early without doing any work.
      await Promise.resolve();
      ctx.markSkipped("sweep disabled via gatesConfig");
    });
    const marker = await mock.get(
      metricsCronRunDocPath("scheduled-injection-sweep-v2"),
    );
    assert(marker, "marker must be written");
    assertEquals(
      marker.lastStatus,
      "skipped",
      "a paused gate must NOT read as ok/green on cron-health",
    );
    assertEquals(marker.skipReason, "sweep disabled via gatesConfig");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordCronRun: a fn that does real work (no markSkipped) still records 'ok'", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await recordCronRun("test-cron-ok", async () => {
      await Promise.resolve();
    });
    const marker = await mock.get(metricsCronRunDocPath("test-cron-ok"));
    assertEquals(marker?.lastStatus, "ok");
    assertEquals(marker?.skipReason, undefined, "ok runs carry no skipReason");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("recordCronRun: a throw still wins over a markSkipped call → 'error'", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    let caught = false;
    try {
      await recordCronRun("test-cron-err", async (ctx) => {
        ctx.markSkipped("about to fail");
        await Promise.resolve();
        throw new Error("boom");
      });
    } catch {
      caught = true;
    }
    assert(caught, "recordCronRun must re-throw");
    const marker = await mock.get(metricsCronRunDocPath("test-cron-err"));
    assertEquals(
      marker?.lastStatus,
      "error",
      "an error must not be masked as skipped",
    );
    assertEquals(marker?.lastError, "boom");
  } finally {
    setFirestoreClientForTests(null);
  }
});
