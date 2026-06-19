import { assertEquals } from "#assert";
import { isDnc, markDnc } from "./mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("dnc: false until marked, true after", async () => {
  const db = new FirestoreMock();
  assertEquals(await isDnc("5551230001", db), false);
  await markDnc("5551230001", "STOP", db);
  assertEquals(await isDnc("5551230001", db), true);
});
