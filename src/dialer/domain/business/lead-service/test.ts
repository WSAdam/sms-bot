import { assertEquals } from "#assert";
import { injectLead } from "./mod.ts";
Deno.test("lead-service: exposes adapter", () => {
  assertEquals(typeof injectLead, "function");
});
