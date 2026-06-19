import { assertEquals } from "#assert";
import { createBooking } from "./mod.ts";
Deno.test("cal: exposes adapter", () => {
  assertEquals(typeof createBooking, "function");
});
