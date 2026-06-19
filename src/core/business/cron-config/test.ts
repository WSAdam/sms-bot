import { assertEquals } from "#assert";
import { getCronConfig, setCronConfig } from "./mod.ts";
Deno.test("cron-config: exposes adapter", () => {
  assertEquals(typeof getCronConfig, "function");
  assertEquals(typeof setCronConfig, "function");
});
