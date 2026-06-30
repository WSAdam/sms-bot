// Pins the intentional fail-closed direction of the nightly report when the
// Firestore read for cron config fails. getCronConfig() has no internal
// try-catch by design: a read failure throws, runNightlyReport propagates it,
// and main.ts's outer try-catch (wrapped by recordCronRun) logs + skips the
// report. Better to miss one morning's email than to send a report built on a
// partially-read config. This test documents that behavior so a refactor that
// "helpfully" swallows the error (and silently proceeds with defaults) fails
// here.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { getCronConfig } from "@core/business/cron-config/mod.ts";
import { recordCronRun } from "@scheduling/domain/data/cron-marker/mod.ts";
import {
  type FirestoreClient,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { metricsCronRunDocPath } from "@shared/firestore/paths.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const READ_FAILS = "getaddrinfo EAI_AGAIN firestore.googleapis.com";

Deno.test("getCronConfig: Firestore read failure propagates (no internal swallow)", async () => {
  const throwing = {
    get: () => Promise.reject(new Error(READ_FAILS)),
  } as unknown as FirestoreClient;
  await assertRejects(
    () => getCronConfig(throwing),
    Error,
    READ_FAILS,
  );
});

Deno.test("nightly cron handler shape: a getCronConfig throw is caught by recordCronRun → run recorded as 'error', report skipped, no crash", async () => {
  // The real cron body in main.ts is `recordCronRun("nightly-report", async () =>
  // { const cfg = await getCronConfig(); ... })`. Model exactly that: the inner
  // fn throws on the config read, recordCronRun captures it as lastStatus:error
  // and re-throws to main.ts's outer try-catch (which logs and does NOT crash).
  const marker = new FirestoreMock();
  setFirestoreClientForTests(marker);
  try {
    const throwing = {
      get: () => Promise.reject(new Error(READ_FAILS)),
    } as unknown as FirestoreClient;

    let outerCaught = false;
    let reportSent = false;
    try {
      // Mirror the handler: recordCronRun wraps the body; main.ts has the outer
      // try-catch.
      await recordCronRun("nightly-report", async () => {
        await getCronConfig(throwing); // throws → report logic below never runs
        reportSent = true; // must NOT be reached
      });
    } catch {
      outerCaught = true; // main.ts's outer try-catch handles this
    }

    assert(outerCaught, "the config-read failure must surface to main.ts");
    assertEquals(
      reportSent,
      false,
      "the report must be skipped on read failure",
    );

    const m = await marker.get(metricsCronRunDocPath("nightly-report"));
    assertEquals(m?.lastStatus, "error", "the run must be recorded as error");
  } finally {
    setFirestoreClientForTests(null);
  }
});
