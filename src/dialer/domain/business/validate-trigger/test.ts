import { assertEquals } from "#assert";
import { parseTriggerPayload } from "./mod.ts";
Deno.test("validate-trigger: exposes adapter", () => {
  assertEquals(typeof parseTriggerPayload, "function");
});
