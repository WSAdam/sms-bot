import { assertEquals } from "#assert";
import { runNightlyReport } from "./mod.ts";
Deno.test("nightly: exposes its entrypoint", () => {
  assertEquals(typeof runNightlyReport, "function");
});
