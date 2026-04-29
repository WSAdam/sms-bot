// Replaces the Phase 0 placeholder with real time-helper tests.

import { assertEquals } from "@std/assert";
import {
  daysBetween,
  easternDateString,
  isWithinWindowAfter,
  parseDateishToMs,
} from "@shared/util/time.ts";

Deno.test("easternDateString returns YYYY-MM-DD", () => {
  // 2026-04-28 12:00 UTC is still 2026-04-28 in Eastern (EDT = UTC-4 → 8am ET)
  const utcNoon = new Date("2026-04-28T16:00:00.000Z");
  assertEquals(easternDateString(utcNoon), "2026-04-28");
});

Deno.test("easternDateString rolls back across midnight UTC", () => {
  // 03:00 UTC on Apr 29 = 23:00 EDT on Apr 28
  const earlyUtc = new Date("2026-04-29T03:00:00.000Z");
  assertEquals(easternDateString(earlyUtc), "2026-04-28");
});

Deno.test("parseDateishToMs accepts strings, numbers, Dates", () => {
  const iso = "2026-04-28T16:00:00.000Z";
  assertEquals(parseDateishToMs(iso), new Date(iso).getTime());
  assertEquals(parseDateishToMs(1234567890), 1234567890);
  assertEquals(parseDateishToMs(new Date(iso)), new Date(iso).getTime());
  assertEquals(parseDateishToMs("not a date"), null);
  assertEquals(parseDateishToMs(undefined), null);
});

Deno.test("isWithinWindowAfter is true at exact boundary", () => {
  const t0 = Date.now();
  const exactlyOneDayLater = t0 + 24 * 60 * 60 * 1000;
  assertEquals(isWithinWindowAfter(t0, exactlyOneDayLater, 1), true);
});

Deno.test("isWithinWindowAfter is false past boundary", () => {
  const t0 = Date.now();
  const justOver = t0 + 7 * 24 * 60 * 60 * 1000 + 1;
  assertEquals(isWithinWindowAfter(t0, justOver, 7), false);
});

Deno.test("isWithinWindowAfter rejects sale before appointment", () => {
  const t0 = Date.now();
  assertEquals(isWithinWindowAfter(t0, t0 - 1000, 7), false);
});

Deno.test("daysBetween counts days correctly", () => {
  const t0 = Date.now();
  assertEquals(daysBetween(t0, t0 + 24 * 60 * 60 * 1000), 1);
  assertEquals(daysBetween(t0, t0 + 7 * 24 * 60 * 60 * 1000), 7);
});
