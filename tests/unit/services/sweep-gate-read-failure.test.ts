// Composes the exact 2026-06-29 incident interleaving that no single existing
// test covered: getGatesConfig() FAILS mid-sweep, serves a LAST-GOOD config
// that happens to be DISABLED, and the cron handler must still (a) skip the
// sweep so no due doc is processed (delay-not-loss) AND (b) record
// lastStatus='skipped' (not 'ok') so cron-health shows PAUSED rather than
// healthy-green. sweep-paused-gate covers an explicitly-disabled gate and
// gates-config-failover covers last-good serving — this test wires them into
// the failure path together, modeling main.ts's cron body.

import { assert, assertEquals } from "@std/assert";
import { shouldRunSweep } from "@/main.ts";
import {
  _clearGatesConfigCache,
  _expireGatesConfigCache,
  getGatesConfig,
} from "@core/business/gates-config/mod.ts";
import { gatesConfigDocPath } from "@core/data/firestore-paths/mod.ts";
import {
  metricsCronRunDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { recordCronRun } from "@scheduling/domain/data/cron-marker/mod.ts";
import { sweepScheduledInjections } from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// A read client that fails the way a DNS blip does.
const blipClient = {
  get: () => Promise.reject(new Error("getaddrinfo EAI_AGAIN")),
} as unknown as FirestoreClient;

Deno.test("gate read failure serving last-good DISABLED config: sweep is skipped, due doc survives, marker is 'skipped'", async () => {
  _clearGatesConfigCache();
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  try {
    // Operator had previously PAUSED the sweep — last-good is disabled.
    await db.set(gatesConfigDocPath(), {
      scheduledInjectionSweepEnabled: false,
      globalDailySmsCap: 250,
      updatedAt: new Date().toISOString(),
    });
    // Prime the cache with that live (disabled) config.
    const primed = await getGatesConfig(db);
    assertEquals(primed.scheduledInjectionSweepEnabled, false);

    // A due scheduledinjection that MUST NOT be processed while paused.
    const phone = "5551236100";
    db.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });

    // Cache expires; the next gates read fails (the incident's DNS blip).
    _expireGatesConfigCache();

    // Model main.ts's cron body: recordCronRun wraps a fn that reads gates,
    // and skips when shouldRunSweep is false. The failing read serves last-good
    // (disabled), so the sweep is correctly skipped.
    let sweepRan = false;
    await recordCronRun("scheduled-injection-sweep-v2", async (ctx) => {
      const gates = await getGatesConfig(blipClient); // serves last-good=disabled
      if (!shouldRunSweep(gates)) {
        ctx.markSkipped("sweep disabled via gatesConfig");
        return;
      }
      sweepRan = true;
      await sweepScheduledInjections("cron", db);
    });

    assertEquals(
      sweepRan,
      false,
      "the sweep must NOT run when last-good gate is disabled",
    );

    // delay-not-loss: the due doc is untouched.
    assert(
      await db.get(scheduledInjectionDocPath(phone)),
      "the due scheduledinjection must survive (delay-not-loss)",
    );

    // cron-health: the run is 'skipped', NOT 'ok' — a disarmed sweep must not
    // masquerade as healthy.
    const marker = await db.get(
      metricsCronRunDocPath("scheduled-injection-sweep-v2"),
    );
    assertEquals(
      marker?.lastStatus,
      "skipped",
      "a paused sweep after a gate-read blip must read as skipped, not ok",
    );
    assertEquals(marker?.skipReason, "sweep disabled via gatesConfig");
  } finally {
    setFirestoreClientForTests(null);
    _clearGatesConfigCache();
  }
});
