import { assertEquals } from "#assert";
import { getRmCreds } from "./mod.ts";
Deno.test("rm-auth: exposes adapter", () => {
  assertEquals(typeof getRmCreds, "function");
});
