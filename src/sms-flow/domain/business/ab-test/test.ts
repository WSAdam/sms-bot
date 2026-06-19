import { assertEquals } from "#assert";
import { getAndToggleVariant } from "./mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("ab-test: alternates A then B", async () => {
  const db = new FirestoreMock();
  assertEquals(await getAndToggleVariant(db), "A");
  assertEquals(await getAndToggleVariant(db), "B");
});
