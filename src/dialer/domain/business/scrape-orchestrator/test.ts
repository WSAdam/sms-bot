import { assertEquals } from "#assert";
import { scrapeReadymode } from "./mod.ts";
Deno.test("scrape-orchestrator: exposes adapter", () => {
  assertEquals(typeof scrapeReadymode, "function");
});
