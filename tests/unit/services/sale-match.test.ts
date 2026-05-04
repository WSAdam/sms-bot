import { assertEquals } from "@std/assert";
import {
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
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

function seedHistory(db: FirestoreMock, phone10: string, daysAgo: number) {
  const eventTime = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000)
    .toISOString();
  const firedAt = new Date().toISOString();
  db.docs.set(
    injectionHistoryDocPath(`${phone10}__${firedAt}`),
    { phone: phone10, eventTime, firedAt, scheduledAt: Date.now() },
  );
}

Deno.test("phone within window matches", async () => {
  const db = setup();
  seed(db, "9999999991", 1); // -1d
  const r = await processSaleMatches([{ phone10: "9999999991" }]);
  assertEquals(r.matched, 1);
  assertEquals(r.skippedNoInjection, 0);
  assertEquals(r.skippedOlderThan7Days, 0);
});

Deno.test("phone exactly at window boundary still matches (8 days)", async () => {
  const db = setup();
  seed(db, "9999999992", 8);
  const r = await processSaleMatches([{ phone10: "9999999992" }]);
  assertEquals(r.matched, 1);
});

Deno.test("phone past window is skipped (9 days)", async () => {
  const db = setup();
  seed(db, "9999999993", 9);
  const r = await processSaleMatches([{ phone10: "9999999993" }]);
  assertEquals(r.matched, 0);
  assertEquals(r.skippedOlderThan7Days, 1);
});

Deno.test("out-of-window run writes salesoutsidewindow doc", async () => {
  const db = setup();
  seed(db, "9999999998", 14); // 14 days ago — outside window
  await processSaleMatches([{ phone10: "9999999998" }]);
  const outside = await db.get(
    "sms-bot/salesoutsidewindow/byPhone/9999999998",
  );
  assertEquals(outside?.phone10, "9999999998");
  assertEquals(typeof outside?.closestDaysDiff, "number");
  assertEquals((outside?.closestDaysDiff as number) >= 14, true);
  // Must NOT also write the within-window marker.
  const within = await db.get("sms-bot/saleswithin7d/byPhone/9999999998");
  assertEquals(within, null);
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

Deno.test("phone with only injectionhistory entry (no pending) still matches", async () => {
  const db = setup();
  // No scheduledinjections doc — only an injectionhistory entry. This is the
  // common case for phones whose appointment SMS already fired and got swept.
  seedHistory(db, "9999999995", 3);
  const r = await processSaleMatches([{ phone10: "9999999995" }]);
  assertEquals(r.matched, 1);
});

Deno.test("phone with multiple history entries picks closest within window", async () => {
  const db = setup();
  // Two history entries: one 30d old (out of window), one 2d old (in window).
  // The 2d entry should be picked.
  seedHistory(db, "9999999996", 30);
  seedHistory(db, "9999999996", 2);
  const r = await processSaleMatches([{ phone10: "9999999996" }]);
  assertEquals(r.matched, 1);
  // withinDays should reflect the 2d match, not the 30d one
  assertEquals(Math.round(r.matches[0].withinDays), 2);
});

Deno.test("same-day appointment + activation matches (date-only saleAt)", async () => {
  const db = setup();
  // Appointment is at 5:15pm ET today. Activation is "today" as a date-only
  // string from QB report — used to false-reject because date-only parses to
  // midnight UTC = 8pm previous-day ET.
  const today = new Date();
  const eventTime = new Date(today);
  eventTime.setHours(17, 15, 0, 0);
  const inj: FutureInjection = {
    phone: "9999999997",
    eventTime: eventTime.toISOString(),
    scheduledAt: Date.now(),
  };
  db.docs.set(scheduledInjectionDocPath("9999999997"), { ...inj });

  // Format today's date the same way QB report 678 returns it.
  const yyyyMmDd = today.toISOString().slice(0, 10);
  const r = await processSaleMatches([
    { phone10: "9999999997", saleAt: yyyyMmDd },
  ]);
  assertEquals(r.matched, 1, "same-day should match");
});
