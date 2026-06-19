import { assertEquals } from "#assert";
import { getCampaignConfig } from "./mod.ts";
Deno.test("campaigns: exposes adapter", () => {
  assertEquals(typeof getCampaignConfig, "function");
});
