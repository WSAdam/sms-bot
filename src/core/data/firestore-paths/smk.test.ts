import { assertEquals } from "#assert";
import { conversationsCollection } from "./mod.ts";
Deno.test("firestore-paths: exposes paths", () => {
  assertEquals(typeof conversationsCollection, "string");
});
