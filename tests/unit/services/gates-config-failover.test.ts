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

Deno.test("getGatesConfig: serving last-good on a read failure does NOT bump cache expiry — the next call retries Firestore", async () => {
  // Load-bearing for the 2026-06-29 incident: a stale gates config with
  // scheduledInjectionSweepEnabled=false must not silently persist for the full
  // TTL if Firestore recovers. The failure path serves last-good but
  // deliberately does NOT refresh cached.at, so the very next call re-reads.
  _clearGatesConfigCache();
  const db = new FirestoreMock();
  await db.set(gatesConfigDocPath(), {
    scheduledInjectionSweepEnabled: true,
    globalDailySmsCap: 250,
    updatedAt: new Date().toISOString(),
  });

  // Prime the cache with the live, armed config.
  await getGatesConfig(db);

  // Expire the cache and fail the read — must serve last-good (armed).
  _expireGatesConfigCache();
  let getCalls = 0;
  const blip = {
    get: () => {
      getCalls++;
      return Promise.reject(new Error("getaddrinfo EAI_AGAIN"));
    },
  } as unknown as FirestoreMock;
  const duringBlip = await getGatesConfig(blip);
  assertEquals(duringBlip.scheduledInjectionSweepEnabled, true);
  assertEquals(getCalls, 1, "the failed read must have hit Firestore once");

  // The KEY assertion: because cached.at was NOT bumped by the failed read,
  // the next call retries Firestore (here, recovered) instead of serving the
  // stale value for the full 60s TTL. If the failure path had refreshed
  // cached.at, this read would be served from cache and Firestore never hit.
  await db.set(gatesConfigDocPath(), {
    scheduledInjectionSweepEnabled: true,
    globalDailySmsCap: 999, // operator bumped it again post-recovery
    updatedAt: new Date().toISOString(),
  });
  const afterRecovery = await getGatesConfig(db);
  assertEquals(
    afterRecovery.globalDailySmsCap,
    999,
    "the next call must retry Firestore (cache.at was not bumped on the failed read)",
  );

  _clearGatesConfigCache();
});
