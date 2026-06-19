import { assertEquals } from "#assert";
import { getFirestoreClient } from "./mod.ts";
Deno.test("firestore-wrapper: exposes adapter", () => {
  assertEquals(typeof getFirestoreClient, "function");
});
