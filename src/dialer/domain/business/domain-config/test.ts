import { assertEquals } from "#assert";
import { DOMAIN_CONFIG } from "./mod.ts";
Deno.test("domain-config: exposes config", () => {
  assertEquals(typeof DOMAIN_CONFIG, "object");
});
