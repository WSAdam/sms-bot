import { assertEquals } from "#assert";
import { fetchAttemptsFromTpi } from "./mod.ts";
Deno.test("tpi-client: exposes adapter", () => {
  assertEquals(typeof fetchAttemptsFromTpi, "function");
});
