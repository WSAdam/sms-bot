import { assertEquals } from "@std/assert";
import { scheduledInjectionDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function setup() {
  const db = new FirestoreMock();
  setFirestoreClientForTests(db);
  return db;
}

function seed(db: FirestoreMock, phone10: string, daysAgo: number) {
  const eventTime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    .toISOString();
  const inj: FutureInjection = {
    phone: phone10,
    eventTime,
    scheduledAt: Date.now(),
  };
  db.docs.set(scheduledInjectionDocPath(phone10), { ...inj });
}

Deno.test("phone within 7-day window matches", async () => {
  const db = setup();
  seed(db, "9999999991", 1); // -1d
  const r = await processSaleMatches([{ phone10: "9999999991" }]);
  assertEquals(r.matched, 1);
  assertEquals(r.skippedNoInjection, 0);
  assertEquals(r.skippedOlderThan7Days, 0);
});

Deno.test("phone exactly at 7-day boundary still matches", async () => {
  const db = setup();
  seed(db, "9999999992", 7);
  const r = await processSaleMatches([{ phone10: "9999999992" }]);
  assertEquals(r.matched, 1);
});

Deno.test("phone past 7 days is skipped", async () => {
  const db = setup();
  seed(db, "9999999993", 8);
  const r = await processSaleMatches([{ phone10: "9999999993" }]);
  assertEquals(r.matched, 0);
  assertEquals(r.skippedOlderThan7Days, 1);
});

Deno.test("phone with no scheduled injection is skipped", async () => {
  setup();
  const r = await processSaleMatches([{ phone10: "0000000000" }]);
  assertEquals(r.matched, 0);
  assertEquals(r.skippedNoInjection, 1);
});

Deno.test("matched run writes both saleswithin7d and guestactivated docs", async () => {
  const db = setup();
  seed(db, "9999999994", 2);
  await processSaleMatches([{ phone10: "9999999994" }]);
  const sale = await db.get("sms-bot/saleswithin7d/byPhone/9999999994");
  const activated = await db.get("sms-bot/guestactivated/byPhone/9999999994");
  assertEquals(sale?.phone10, "9999999994");
  assertEquals(activated?.Activated, true);
});
