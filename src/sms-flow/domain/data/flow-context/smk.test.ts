import { assertEquals } from "#assert";
import { getContext, saveContext } from "./mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("flow-context: round-trips saved fields", async () => {
  const db = new FirestoreMock();
  await saveContext("5551230001", { reservationId: "r1" }, db);
  const ctx = await getContext("5551230001", db);
  assertEquals(ctx?.reservationId, "r1");
});
