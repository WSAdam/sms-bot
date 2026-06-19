import { assertEquals } from "#assert";
import { sweepScheduledInjections } from "./mod.ts";
Deno.test("inj-sweep: exposes adapter", () => {
  assertEquals(typeof sweepScheduledInjections, "function");
});
