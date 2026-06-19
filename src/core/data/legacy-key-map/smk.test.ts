import { assertEquals } from "#assert";
import { legacyKeyToDocPath } from "./mod.ts";
Deno.test("legacy-key-map: exposes adapter", () => {
  assertEquals(typeof legacyKeyToDocPath, "function");
});
