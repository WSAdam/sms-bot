import { assertEquals } from "#assert";
import { recordCronRun } from "./mod.ts";
Deno.test("cron-marker: exposes adapter", () => {
  assertEquals(typeof recordCronRun, "function");
});
