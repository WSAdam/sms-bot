import { assertEquals } from "#assert";
import { normalizePhone } from "./mod.ts";
Deno.test("phone: exposes helpers", () => {
  assertEquals(typeof normalizePhone, "function");
});
