import { assertEquals } from "#assert";
import { getPointer, updatePointer } from "./mod.ts";
Deno.test("orchestrator-store: exposes adapter", () => {
  assertEquals(typeof getPointer, "function");
  assertEquals(typeof updatePointer, "function");
});
