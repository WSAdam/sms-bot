import { assertEquals } from "#assert";
import { checkOnly, reserve } from "./mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("rate-limiter: allows first, blocks within window after reserve", async () => {
  const db = new FirestoreMock();
  assertEquals(await checkOnly("5551230001", db), true);
  await reserve("5551230001", db);
  assertEquals(await checkOnly("5551230001", db), false);
});
