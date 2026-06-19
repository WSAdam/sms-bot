import { assertEquals } from "#assert";
import { getGatesConfig, setGatesConfig } from "./mod.ts";
Deno.test("gates-config: exposes adapter", () => {
  assertEquals(typeof getGatesConfig, "function");
  assertEquals(typeof setGatesConfig, "function");
});
