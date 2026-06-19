import { assertEquals } from "#assert";
import { scanConversationsForBookings } from "./mod.ts";
Deno.test("booking-scan: exposes the scanner", () => {
  assertEquals(typeof scanConversationsForBookings, "function");
});
