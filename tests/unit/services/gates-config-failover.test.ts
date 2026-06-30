// Guards the gates-config read-failure fix (incident 2026-06-29). A transient
// Firestore EAI_AGAIN DNS blip made getGatesConfig() fall back to
// GATES_CONFIG_DEFAULTS, whose scheduledInjectionSweepEnabled is `false` — so a
// single read failure silently DISARMED the per-minute injection sweep (and
// reverted operator-tuned caps) until the cache refilled. The fix serves the
// last-good cached value on failure, and only falls back to safe defaults on a
// cold start with no successful read yet.

import { assertEquals } from "@std/assert";
import {
  _clearGatesConfigCache,
  _expireGatesConfigCache,
  GATES_CONFIG_DEFAULTS,
  getGatesConfig,
} from "@core/business/gates-config/mod.ts";
import { gatesConfigDocPath } from "@core/data/firestore-paths/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// A client whose read always fails the way Deno Deploy's REST transport does
// during a DNS blip.
const throwingClient = {
  get: () =>
    Promise.reject(
      new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
    ),
} as unknown as FirestoreMock;

Deno.test("getGatesConfig: a read failure AFTER a good read serves last-good (sweep stays ARMED), not defaults", async () => {
  _clearGatesConfigCache();
  const db = new FirestoreMock();
  // Operator has armed the sweep and tuned the daily cap above the default.
  await db.set(gatesConfigDocPath(), {
    scheduledInjectionSweepEnabled: true,
    globalDailySmsCap: 250,
    updatedAt: new Date().toISOString(),
  });

  // First read caches the live, armed config.
  const first = await getGatesConfig(db);
  assertEquals(first.scheduledInjectionSweepEnabled, true);
  assertEquals(first.globalDailySmsCap, 250);

  // Cache expires; the next read hits Firestore and it's down (EAI_AGAIN).
  _expireGatesConfigCache();
  const duringBlip = await getGatesConfig(throwingClient);

  // CRITICAL: serve last-good, NOT defaults. A blip must NOT disarm the sweep
  // (default false) or revert the tuned cap (default 100) — that's the bug.
  assertEquals(duringBlip.scheduledInjectionSweepEnabled, true);
  assertEquals(duringBlip.globalDailySmsCap, 250);

  _clearGatesConfigCache();
});

Deno.test("getGatesConfig: a read failure with NO prior good read falls back to SAFE defaults (sweep paused)", async () => {
  _clearGatesConfigCache();
  // Cold start: Firestore unreachable before we ever read the live config.
  const cold = await getGatesConfig(throwingClient);
  assertEquals(
    cold.scheduledInjectionSweepEnabled,
    GATES_CONFIG_DEFAULTS.scheduledInjectionSweepEnabled, // false — safe posture
  );
  assertEquals(
    cold.globalDailySmsCap,
    GATES_CONFIG_DEFAULTS.globalDailySmsCap,
  );
  _clearGatesConfigCache();
});
