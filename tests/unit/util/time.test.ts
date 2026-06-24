// Replaces the Phase 0 placeholder with real time-helper tests.

import { assertEquals, assertThrows } from "@std/assert";
import {
  daysBetween,
  easternDateString,
  isWithinWindowAfter,
  normalizeAppointmentTime,
  parseDateishToMs,
} from "@shared/util/time.ts";

Deno.test("normalizeAppointmentTime canonicalizes a valid TZ-marked time to UTC ISO", () => {
  assertEquals(
    normalizeAppointmentTime("2026-05-19T12:00:00Z", undefined),
    "2026-05-19T12:00:00.000Z",
  );
});

Deno.test("normalizeAppointmentTime THROWS on a syntactically-invalid TZ-marked time (no silent passthrough)", () => {
  // Previously returned the bad string unchanged; scheduleInjection's regex
  // (sees the trailing Z) would accept it, the sweep's eventTime<=now string
  // compare would never match, and the injection would silently never fire —
  // losing the lead. It must reject loudly instead.
  assertThrows(
    () => normalizeAppointmentTime("2026-99-99T12:00:00Z", undefined),
    Error,
    "Invalid appointment time",
  );
  assertThrows(
    () => normalizeAppointmentTime("2026-13-40T99:99:99-04:00", undefined),
    Error,
    "Invalid appointment time",
  );
});

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
