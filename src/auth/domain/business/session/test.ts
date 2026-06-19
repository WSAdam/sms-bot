import { assertEquals } from "#assert";
import { signSession } from "./mod.ts";
Deno.test("session: exposes api", () => {
  assertEquals(typeof signSession, "function");
});
