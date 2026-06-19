import { assertEquals } from "#assert";
import { saveAuditMarker } from "./mod.ts";
Deno.test("audit: exposes its entrypoint", () => {
  assertEquals(typeof saveAuditMarker, "function");
});
