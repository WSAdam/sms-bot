import { assertEquals } from "#assert";
import { storeMessage } from "./mod.ts";
Deno.test("conv-store: exposes its adapter", () => {
  assertEquals(typeof storeMessage, "function");
});
