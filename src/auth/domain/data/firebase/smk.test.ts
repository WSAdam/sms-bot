import { assertEquals } from "#assert";
import { verifyFirebaseIdToken } from "./mod.ts";
Deno.test("firebase: exposes verifier", () => {
  assertEquals(typeof verifyFirebaseIdToken, "function");
});
