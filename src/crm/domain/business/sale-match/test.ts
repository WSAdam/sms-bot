import { assertEquals } from "#assert";
import { processSaleMatches } from "./mod.ts";
Deno.test("sale-match: exposes the matcher", () => {
  assertEquals(typeof processSaleMatches, "function");
});
