import { assertEquals } from "#assert";
import { normalize } from "./mod.ts";
Deno.test("mapping: exposes adapter", () => {
  assertEquals(typeof normalize, "function");
});
