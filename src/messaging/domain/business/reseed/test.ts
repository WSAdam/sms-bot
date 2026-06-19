import { assertEquals } from "#assert";
import { reseedConversationsByDateRange } from "./mod.ts";
Deno.test("reseed: exposes the reseeder", () => {
  assertEquals(typeof reseedConversationsByDateRange, "function");
});
