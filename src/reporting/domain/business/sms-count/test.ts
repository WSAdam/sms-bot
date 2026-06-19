// Co-located unit test for the sms-count business feature.
import { assertEquals } from "#assert";
import { getCount, increment } from "./mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("sms-count: getCount defaults to 0", async () => {
  const db = new FirestoreMock();
  assertEquals(await getCount("2026-06-19", db), 0);
});

Deno.test("sms-count: increment bumps the daily counter", async () => {
  const db = new FirestoreMock();
  await increment("2026-06-19", db);
  const n = await increment("2026-06-19", db);
  assertEquals(n, 2);
  assertEquals(await getCount("2026-06-19", db), 2);
});
