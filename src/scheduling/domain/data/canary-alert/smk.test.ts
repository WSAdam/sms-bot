import { assertEquals } from "#assert";
import { pushInjectionFailure } from "./mod.ts";
Deno.test("canary-alert: exposes adapter", () => {
  assertEquals(typeof pushInjectionFailure, "function");
});
