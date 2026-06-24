// Guards the A/B variant toggle race fix. getAndToggleVariant used to read the
// global toggle with get(), compute the next value, then write it with set() —
// a non-atomic read-modify-write. Two concurrent SMS triggers could both read
// value=0, both return "A", and both write 1, collapsing the intended A,B,A,B
// alternation. The fix performs the read-flip-write inside one Firestore
// transaction (mirrors reserveGlobalDailySlot / setGatesConfig).

import { assertEquals } from "@std/assert";
import { getAndToggleVariant } from "@sms-flow/domain/business/ab-test/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("getAndToggleVariant alternates A,B,A,B on sequential calls", async () => {
  const db = new FirestoreMock();
  const got = [
    await getAndToggleVariant(db),
    await getAndToggleVariant(db),
    await getAndToggleVariant(db),
    await getAndToggleVariant(db),
  ];
  assertEquals(got, ["A", "B", "A", "B"]);
});

Deno.test("getAndToggleVariant: concurrent triggers split evenly (no race collapse)", async () => {
  const db = new FirestoreMock();
  // Fire 8 toggles concurrently. With the non-atomic get()+set() they would
  // race and skew heavily toward "A"; the transactional version serializes the
  // flip so exactly 4 land on each variant.
  const results = await Promise.all(
    Array.from({ length: 8 }, () => getAndToggleVariant(db)),
  );
  const aCount = results.filter((v) => v === "A").length;
  const bCount = results.filter((v) => v === "B").length;
  assertEquals(aCount, 4);
  assertEquals(bCount, 4);
});

Deno.test("getAndToggleVariant: defaults to A when Firestore throws", async () => {
  const db = new FirestoreMock();
  // deno-lint-ignore no-explicit-any
  (db as any).transactionalUpdate = () =>
    Promise.reject(new Error("firestore down"));
  assertEquals(await getAndToggleVariant(db), "A");
});
