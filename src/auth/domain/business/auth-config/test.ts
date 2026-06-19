import { assertEquals } from "#assert";
import { getAuthConfig } from "./mod.ts";
Deno.test("auth-config: exposes api", () => {
  assertEquals(typeof getAuthConfig, "function");
});
