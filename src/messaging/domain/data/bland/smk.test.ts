import { assertEquals } from "#assert";
import { sendSms } from "./mod.ts";
Deno.test("bland: exposes its adapter", () => {
  assertEquals(typeof sendSms, "function");
});
