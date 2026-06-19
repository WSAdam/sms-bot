import { assertEquals } from "#assert";
import { runDailyQbSaleMatch } from "./mod.ts";
Deno.test("sale-match-cron: exposes the daily cron", () => {
  assertEquals(typeof runDailyQbSaleMatch, "function");
});
