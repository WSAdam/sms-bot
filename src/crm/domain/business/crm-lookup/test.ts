import { assertEquals } from "#assert";
import { findGuestByResId } from "./mod.ts";
Deno.test("crm-lookup: exposes the reservation lookup", () => {
  assertEquals(typeof findGuestByResId, "function");
});
