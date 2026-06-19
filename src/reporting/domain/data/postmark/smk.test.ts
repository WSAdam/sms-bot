import { assertEquals } from "#assert";
import { sendReport } from "./mod.ts";
Deno.test("postmark: exposes sendReport adapter", () => {
  assertEquals(typeof sendReport, "function");
});
