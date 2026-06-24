// Guards the global-daily-cap race fix. The old flow read the daily count at
// the gate and incremented it AFTER the Bland send — N concurrent requests
// could all read the same sub-cap count, all pass, and collectively overshoot
// the cap. reserveGlobalDailySlot does the read-check-increment inside ONE
// transaction so the cap is honored under concurrency.

import { assertEquals } from "@std/assert";
import {
  _releaseGlobalDailySlotForTest as releaseGlobalDailySlot,
  _reserveGlobalDailySlotForTest as reserveGlobalDailySlot,
} from "@dialer/domain/business/lead-service/mod.ts";
import { globalSmsCountDocPath } from "@shared/firestore/paths.ts";
import { easternDateString } from "@shared/util/time.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const countPath = () => globalSmsCountDocPath(easternDateString());

Deno.test("reserveGlobalDailySlot: grants slots up to the cap, then denies", async () => {
  const db = new FirestoreMock();
  assertEquals(await reserveGlobalDailySlot(db, 3), true);
  assertEquals(await reserveGlobalDailySlot(db, 3), true);
  assertEquals(await reserveGlobalDailySlot(db, 3), true);
  assertEquals(await reserveGlobalDailySlot(db, 3), false); // cap reached
  const doc = await db.get(countPath());
  assertEquals(doc?.count, 3);
});

Deno.test("reserveGlobalDailySlot: concurrent requests cannot overshoot the cap", async () => {
  const db = new FirestoreMock();
  // Pre-seed count=9, cap=10. Fire 10 concurrent reservations. Exactly ONE
  // should win (the 10th slot); the other 9 must be denied. Final count = 10.
  await db.set(countPath(), { count: 9 });
  const results = await Promise.all(
    Array.from({ length: 10 }, () => reserveGlobalDailySlot(db, 10)),
  );
  assertEquals(results.filter((r) => r === true).length, 1);
  const doc = await db.get(countPath());
  assertEquals(doc?.count, 10);
});

Deno.test("releaseGlobalDailySlot: rolls back a reserved slot, never below 0", async () => {
  const db = new FirestoreMock();
  await reserveGlobalDailySlot(db, 5); // count=1
  await releaseGlobalDailySlot(db); // count=0
  let doc = await db.get(countPath());
  assertEquals(doc?.count, 0);
  // Releasing an empty counter never goes negative.
  await releaseGlobalDailySlot(db);
  doc = await db.get(countPath());
  assertEquals(doc?.count, 0);
});
