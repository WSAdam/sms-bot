import { assertEquals } from "#assert";
import { scheduleInjection } from "./mod.ts";
Deno.test("inj-schedule: exposes adapter", () => {
  assertEquals(typeof scheduleInjection, "function");
});
