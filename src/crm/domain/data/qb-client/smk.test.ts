import { assertEquals } from "#assert";
import { getQuickbaseClient } from "./mod.ts";
Deno.test("qb-client: exposes a client factory", () => {
  assertEquals(typeof getQuickbaseClient, "function");
});
