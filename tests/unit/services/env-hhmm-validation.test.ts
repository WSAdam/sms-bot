// Guards the HH:MM 24h validation fix. The old regex /^[0-2][0-9]:[0-5][0-9]$/
// accepted hours 00-29 (first digit 0-2, second 0-9), so "24:00"/"25:30"/
// "29:59" were stored as valid INBOUND_WINDOW_START_ET/END_ET. The tightened
// regex only accepts 00-23.

import { assertEquals } from "@std/assert";
import { parseHhMmOr } from "@core/business/env/mod.ts";

Deno.test("parseHhMmOr: accepts valid 00:00-23:59", () => {
  assertEquals(parseHhMmOr("00:00", "X"), "00:00");
  assertEquals(parseHhMmOr("09:30", "X"), "09:30");
  assertEquals(parseHhMmOr("19:05", "X"), "19:05");
  assertEquals(parseHhMmOr("23:59", "X"), "23:59");
});

Deno.test("parseHhMmOr: REJECTS invalid hours 24-29 (falls back to default)", () => {
  assertEquals(parseHhMmOr("24:00", "08:00"), "08:00");
  assertEquals(parseHhMmOr("25:30", "08:00"), "08:00");
  assertEquals(parseHhMmOr("29:59", "08:00"), "08:00");
});

Deno.test("parseHhMmOr: rejects other malformed input and null", () => {
  assertEquals(parseHhMmOr("9:5", "08:00"), "08:00");
  assertEquals(parseHhMmOr("12:60", "08:00"), "08:00");
  assertEquals(parseHhMmOr("ab:cd", "08:00"), "08:00");
  assertEquals(parseHhMmOr(null, "08:00"), "08:00");
});
