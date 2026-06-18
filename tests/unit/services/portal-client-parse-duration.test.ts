// Direct coverage for parseDurationSeconds — the HTML-strip + regex logic that
// turns RM's "Calltime" cell into seconds. The answered gate (>= 60s) depends
// on it, and both the live import and the campaign backfill now share this one
// exported copy, so its semantics are pinned here.

import { assertEquals } from "@std/assert";
import { parseDurationSeconds } from "@shared/services/readymode/portal-client.ts";

Deno.test("parseDurationSeconds: sub-minute '<' forms and empty → 0", () => {
  assertEquals(parseDurationSeconds("<30s"), 0);
  assertEquals(parseDurationSeconds("< 1m"), 0);
  // Real production wrapper for a short call.
  assertEquals(
    parseDurationSeconds("<small style='opacity:0.5;'><30s</small>&nbsp;"),
    0,
  );
  assertEquals(parseDurationSeconds(""), 0);
  assertEquals(parseDurationSeconds("&nbsp;"), 0);
});

Deno.test("parseDurationSeconds: M:SS", () => {
  assertEquals(parseDurationSeconds("2:05"), 125);
  assertEquals(parseDurationSeconds("0:59"), 59);
});

Deno.test("parseDurationSeconds: H:MM:SS (>= 1hr)", () => {
  assertEquals(parseDurationSeconds("1:05:30"), 3930);
  assertEquals(parseDurationSeconds("2:00:00"), 7200);
});

Deno.test("parseDurationSeconds: word forms + HTML wrapper", () => {
  assertEquals(parseDurationSeconds("21 min"), 1260);
  assertEquals(parseDurationSeconds("<small>21 min</small>&nbsp;"), 1260);
  assertEquals(parseDurationSeconds("41 min"), 2460);
  assertEquals(parseDurationSeconds("1 hr 5 min"), 3900);
  assertEquals(parseDurationSeconds("45 sec"), 45);
  assertEquals(parseDurationSeconds("45s"), 45);
});
