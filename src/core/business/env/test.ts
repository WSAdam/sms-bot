import { assertEquals } from "#assert";
import { loadEnv } from "./mod.ts";
Deno.test("env: exposes loader", () => {
  assertEquals(typeof loadEnv, "function");
});
