// Guards the DST-aware ET day-boundary helper that replaced the hardcoded
// "-04:00" (EDT) offset in drill.ts / stats.ts / appointments.ts and the
// missing offset in audit/browse.ts. The old code was correct only Mar–Nov;
// Nov–Mar (EST, -05:00) every date-range query landed an hour off, shifting the
// reply/booking/audit counts. etDayBoundaryIso derives the offset for the
// SPECIFIC date so the boundary is right across DST.

import { assertEquals } from "@std/assert";
import { etDayBoundaryIso } from "@core/business/time/mod.ts";

Deno.test("etDayBoundaryIso: EDT (summer) start = ET 00:00 at -04:00 offset", () => {
  // 2026-07-15 00:00 EDT = 2026-07-15 04:00 UTC.
  assertEquals(
    etDayBoundaryIso("2026-07-15", "start"),
    "2026-07-15T04:00:00.000Z",
  );
});

Deno.test("etDayBoundaryIso: EDT (summer) end = ET 23:59:59.999 at -04:00 offset", () => {
  // 2026-07-15 23:59:59.999 EDT = 2026-07-16 03:59:59.999 UTC.
  assertEquals(
    etDayBoundaryIso("2026-07-15", "end"),
    "2026-07-16T03:59:59.999Z",
  );
});

Deno.test("etDayBoundaryIso: EST (winter) start uses -05:00, NOT the old hardcoded -04:00", () => {
  // 2026-01-15 00:00 EST = 2026-01-15 05:00 UTC. The buggy hardcoded -04:00
  // would have produced 04:00Z — an hour early — for the whole EST season.
  const got = etDayBoundaryIso("2026-01-15", "start");
  assertEquals(got, "2026-01-15T05:00:00.000Z");
  // Pin the regression: the wrong (EDT) answer must NOT be produced.
  assertEquals(
    got === "2026-01-15T04:00:00.000Z",
    false,
    "winter boundary must not use the EDT (-04:00) offset",
  );
});

Deno.test("etDayBoundaryIso: EST (winter) end uses -05:00", () => {
  // 2026-01-15 23:59:59.999 EST = 2026-01-16 04:59:59.999 UTC.
  assertEquals(
    etDayBoundaryIso("2026-01-15", "end"),
    "2026-01-16T04:59:59.999Z",
  );
});

Deno.test("etDayBoundaryIso: falsy input → null (preserves caller's nullable shape)", () => {
  assertEquals(etDayBoundaryIso(null, "start"), null);
  assertEquals(etDayBoundaryIso(undefined, "end"), null);
  assertEquals(etDayBoundaryIso("", "start"), null);
});

Deno.test("etDayBoundaryIso: invalid date string → null (not a thrown error)", () => {
  assertEquals(etDayBoundaryIso("not-a-date", "start"), null);
});
