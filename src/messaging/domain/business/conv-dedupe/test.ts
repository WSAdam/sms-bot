import { assertEquals } from "#assert";
import { dedupeMessages } from "./mod.ts";
Deno.test("conv-dedupe: empty in → empty out", () => {
  assertEquals(dedupeMessages([]), []);
});
