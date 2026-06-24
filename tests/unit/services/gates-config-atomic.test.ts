// Guards the lost-update fix for setGatesConfig. The old code read the cached
// config (60s TTL), merged a partial, and plain-set() it back — two concurrent
// admin writes to DIFFERENT fields both read the same stale snapshot and the
// second write clobbered the first. setGatesConfig now read-merge-writes inside
// a Firestore transaction against the LIVE doc.

import { assertEquals } from "@std/assert";
import {
  _clearGatesConfigCache,
  GATES_CONFIG_DEFAULTS,
  getGatesConfig,
  setGatesConfig,
} from "@core/business/gates-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("setGatesConfig: concurrent writes to different fields both survive (no lost update)", async () => {
  const db = new FirestoreMock();
  _clearGatesConfigCache();
  // Seed a known starting state.
  await setGatesConfig({ attemptsThreshold: 3, globalDailySmsCap: 500 }, db);
  _clearGatesConfigCache();

  // Two near-simultaneous admin POSTs touching DIFFERENT fields. With the
  // transactional read-merge-write, the second sees the first's committed
  // change instead of a stale cache, so neither update is lost.
  await Promise.all([
    setGatesConfig({ attemptsThreshold: 5 }, db),
    setGatesConfig({ globalDailySmsCap: 1000 }, db),
  ]);

  _clearGatesConfigCache();
  const final = await getGatesConfig(db);
  assertEquals(final.attemptsThreshold, 5);
  assertEquals(final.globalDailySmsCap, 1000);
});

Deno.test("setGatesConfig: a single partial update leaves other fields at their prior values", async () => {
  const db = new FirestoreMock();
  _clearGatesConfigCache();
  await setGatesConfig({ rateLimitWindowDays: 14 }, db);
  _clearGatesConfigCache();
  const got = await getGatesConfig(db);
  assertEquals(got.rateLimitWindowDays, 14);
  // Untouched field keeps its default.
  assertEquals(
    got.saleMatchWindowDays,
    GATES_CONFIG_DEFAULTS.saleMatchWindowDays,
  );
});
