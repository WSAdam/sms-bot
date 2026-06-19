import { assertEquals } from "#assert";
import { authGate } from "./mod.ts";
Deno.test("middleware: exposes api", () => {
  assertEquals(typeof authGate, "function");
});
