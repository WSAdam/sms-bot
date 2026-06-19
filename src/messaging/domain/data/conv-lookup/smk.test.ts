import { assertEquals } from "#assert";
import { getPhoneByCallId } from "./mod.ts";
Deno.test("conv-lookup: exposes its adapter", () => {
  assertEquals(typeof getPhoneByCallId, "function");
});
