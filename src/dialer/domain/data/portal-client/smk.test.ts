import { assertEquals } from "#assert";
import { login } from "./mod.ts";
Deno.test("portal-client: exposes adapter", () => {
  assertEquals(typeof login, "function");
});
