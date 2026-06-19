import { assertEquals } from "#assert";
import { normalizeBookingRows, realGetReport } from "./mod.ts";
Deno.test("qb-report: exposes report + normalizer", () => {
  assertEquals(typeof realGetReport, "function");
  assertEquals(typeof normalizeBookingRows, "function");
});
