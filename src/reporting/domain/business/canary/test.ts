import { assertEquals } from "#assert";
import { gatherHardErrorsForYesterday } from "./mod.ts";
Deno.test("canary: exposes its entrypoint", () => {
  assertEquals(typeof gatherHardErrorsForYesterday, "function");
});
