import { assertEquals } from "#assert";
import { handleDelayedInjection } from "./mod.ts";
Deno.test("delayed-injection: exposes adapter", () => {
  assertEquals(typeof handleDelayedInjection, "function");
});
