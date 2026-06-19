import { assertEquals } from "#assert";
import { refreshKvBreakdown } from "./mod.ts";
Deno.test("kv-breakdown: exposes adapter", () => {
  assertEquals(typeof refreshKvBreakdown, "function");
});
