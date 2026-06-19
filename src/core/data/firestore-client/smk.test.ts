import { assertEquals } from "#assert";
import { getDb } from "./mod.ts";
Deno.test("firestore-client: exposes adapter", () => {
  assertEquals(typeof getDb, "function");
});
