import { assertEquals } from "#assert";
import { importDailyDispositions } from "./mod.ts";
Deno.test("import-dispositions: exposes adapter", () => {
  assertEquals(typeof importDailyDispositions, "function");
});
