import { assertEquals } from "@std/assert";
import {
  normalizeBookingRows,
  normalizeBookingRowsDetailed,
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

Deno.test("normalizeBookingRowsDetailed auto-detects fields by type (report 678)", () => {
  // Report 678 schema: phone in field -1, arrival date in field 8
  const resp: QuickbaseReportResponse = {
    fields: [
      { id: -1, label: "Phone", type: "phone" },
      { id: 8, label: "Arrival Date", type: "date" },
    ],
    data: [
      {
        "-1": { value: "(936) 676-2277" },
        "8": { value: "2026-04-20" },
      },
    ],
  };
  const result = normalizeBookingRowsDetailed(resp);
  assertEquals(result.phoneFieldId, "-1");
  assertEquals(result.dateFieldId, "8");
  assertEquals(result.rows.length, 1);
  assertEquals(result.rows[0].phone10, "9366762277");
  assertEquals(result.rows[0].addedDate, "2026-04-20");
});

Deno.test("normalizeBookingRowsDetailed falls back to label match when type missing", () => {
  const resp: QuickbaseReportResponse = {
    fields: [
      { id: 99, label: "Phone Number", type: "text" },
      { id: 100, label: "Date Activated", type: "text" },
    ],
    data: [{ "99": { value: "555-123-4567" }, "100": { value: "2026-04-01" } }],
  };
  const result = normalizeBookingRowsDetailed(resp);
  assertEquals(result.phoneFieldId, "99");
  assertEquals(result.dateFieldId, "100");
  assertEquals(result.rows[0].phone10, "5551234567");
});

Deno.test("normalizeBookingRowsDetailed falls back to legacy 48/-1 when no metadata", () => {
  const resp: QuickbaseReportResponse = {
    data: [{ "48": { value: "(555) 999-1234" }, "-1": { value: "2026-04-01" } }],
  };
  const result = normalizeBookingRowsDetailed(resp);
  assertEquals(result.phoneFieldId, "48");
  assertEquals(result.dateFieldId, null);
  assertEquals(result.rows[0].phone10, "5559991234");
});

Deno.test("normalizeBookingRowsDetailed picks up activator field by label", () => {
  const resp: QuickbaseReportResponse = {
    fields: [
      { id: -1, label: "Phone", type: "phone" },
      { id: 8, label: "Date Activated", type: "date" },
      { id: 200, label: "Activator", type: "user" },
    ],
    data: [{
      "-1": { value: "(555) 555-5555" },
      "8": { value: "2026-05-04" },
      "200": { value: "ODR - Rodger Gamble" },
    }],
  };
  const result = normalizeBookingRowsDetailed(resp);
  assertEquals(result.activatorFieldId, "200");
  assertEquals(result.rows[0].activator, "ODR - Rodger Gamble");
});
