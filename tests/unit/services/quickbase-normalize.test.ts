import { assertEquals } from "@std/assert";
import {
  normalizeBookingRows,
} from "@shared/services/quickbase/report.ts";
import type { QuickbaseReportResponse } from "@shared/services/quickbase/client.ts";

Deno.test("normalizeBookingRows extracts phone10 from field 48", () => {
  const resp: QuickbaseReportResponse = {
    data: [
      {
        "48": { value: "(936) 676-2277" },
        "-1": { value: "2026-04-20" },
        "-100": { value: "7 Days" },
        "-101": { value: "Active Date Legs" },
      },
      {
        "48": { value: "843-222-2986" },
        "-1": { value: "2026-04-21" },
      },
    ],
  };
  const rows = normalizeBookingRows(resp);
  assertEquals(rows.length, 2);
  assertEquals(rows[0].phone10, "9366762277");
  assertEquals(rows[0].phoneRaw, "(936) 676-2277");
  assertEquals(rows[0].addedDate, "2026-04-20");
  assertEquals(rows[1].phone10, "8432222986");
});

Deno.test("normalizeBookingRows skips rows missing field 48", () => {
  const resp: QuickbaseReportResponse = {
    data: [
      { "-1": { value: "2026-04-20" } } as Record<string, { value: unknown }>,
      { "48": { value: "(555) 123-4567" } },
    ],
  };
  assertEquals(normalizeBookingRows(resp).length, 1);
});

Deno.test("normalizeBookingRows handles empty data array", () => {
  assertEquals(normalizeBookingRows({ data: [] }).length, 0);
});

Deno.test("normalizeBookingRows handles 11-digit (with country code) phones", () => {
  const resp: QuickbaseReportResponse = {
    data: [{ "48": { value: "1-936-676-2277" } }],
  };
  const rows = normalizeBookingRows(resp);
  assertEquals(rows[0].phone10, "9366762277");
});
