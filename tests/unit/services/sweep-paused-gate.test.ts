// Guards the delay-not-loss safety the 2026-06-29 DNS-blip incident relied on:
// when scheduledInjectionSweepEnabled is false, main.ts returns early WITHOUT
// calling sweepScheduledInjections, so due scheduledinjection docs accumulate
// undeleted and a later enable must re-drain them. The safe default disarms the
// sweep; disarmed injections must still be re-dialed once the gate flips back
// on — nothing is lost, only delayed.

import { assert, assertEquals } from "@std/assert";
import { shouldRunSweep } from "@/main.ts";
import {
  GATES_CONFIG_DEFAULTS,
  type GatesConfig,
} from "@core/business/gates-config/mod.ts";
import {
  injectionHistoryCollection,
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { sweepScheduledInjections } from "@scheduling/domain/business/inj-sweep/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function gates(overrides: Partial<GatesConfig>): GatesConfig {
  return { ...GATES_CONFIG_DEFAULTS, ...overrides };
}

Deno.test("paused sweep (gate false): main does NOT sweep and the due doc survives undeleted", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551234100";
    // A due scheduledinjection (eventTime in the past).
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });

    // Gate OFF — the cron handler short-circuits before sweepScheduledInjections.
    assertEquals(
      shouldRunSweep(gates({ scheduledInjectionSweepEnabled: false })),
      false,
    );
    // (handler returns here; sweep is NEVER called)

    // The due doc must remain — delay-not-loss.
    const stillThere = await mock.get(scheduledInjectionDocPath(phone));
    assert(
      stillThere,
      "the due scheduledinjection must NOT be deleted while paused",
    );
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("re-enabled sweep (gate true): the same due doc is processed, deleted, and an injectionhistory entry is written", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551234101";
    mock.docs.set(scheduledInjectionDocPath(phone), {
      phone,
      eventTime: "2020-01-01T00:00:00.000Z",
      scheduledAt: Date.now(),
    });
    // Seed a RECENT injectionhistory so handleDelayedInjection's dedup guard
    // short-circuits to {skipped} BEFORE any ReadyMode/Bland HTTP — keeps the
    // test offline while still exercising the sweep's history-write + delete.
    mock.docs.set(injectionHistoryDocPath(`${phone}__seed`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    // Gate flips ON.
    assertEquals(
      shouldRunSweep(gates({ scheduledInjectionSweepEnabled: true })),
      true,
    );
    const r = await sweepScheduledInjections("cron", mock);
    assertEquals(
      r.scanned,
      1,
      "the previously-paused due doc is now considered",
    );

    // The doc is drained (deleted)...
    assertEquals(
      await mock.get(scheduledInjectionDocPath(phone)),
      null,
      "the re-enabled sweep must delete the doc it processed",
    );
    // ...and a fresh injectionhistory entry exists (seed + sweep entry).
    const history = await mock.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone },
    });
    assert(history.length >= 2, "a new injectionhistory entry must be written");
  } finally {
    setFirestoreClientForTests(null);
  }
});
