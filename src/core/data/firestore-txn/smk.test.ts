import { assertEquals } from "#assert";
import { claim } from "./mod.ts";
Deno.test("firestore-txn: exposes adapter", () => {
  assertEquals(typeof claim, "function");
});
