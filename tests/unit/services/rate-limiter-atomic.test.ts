// Guards the atomic check-and-reserve fix for the per-phone rate limiter.
// The old flow did checkOnly() then (much later, after the Bland send)
// reserve() — two concurrent requests for the same phone both read a stale
// timestamp, both passed, and both sent a duplicate SMS. checkAndReserve does
// the read-and-set inside ONE transaction so only one wins.

import { assertEquals } from "@std/assert";
import {
  checkAndReserve,
  checkOnly,
  release,
  reserve,
} from "@sms-flow/domain/business/rate-limiter/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("checkAndReserve: first caller wins, second is told to stand down (within window)", async () => {
  const db = new FirestoreMock();
  assertEquals(await checkAndReserve("5551230002", db), true);
  assertEquals(await checkAndReserve("5551230002", db), false);
});

Deno.test("checkAndReserve: concurrent same-phone requests — exactly ONE wins (no duplicate send)", async () => {
  const db = new FirestoreMock();
  const phone = "5551230003";
  // Fire 10 concurrent reservations against the SAME phone. The mock
  // serializes transactionalUpdate the way Firestore does, so exactly one
  // must win.
  const results = await Promise.all(
    Array.from({ length: 10 }, () => checkAndReserve(phone, db)),
  );
  const winners = results.filter((r) => r === true).length;
  assertEquals(winners, 1);
});

Deno.test("checkAndReserve: different phones each win independently", async () => {
  const db = new FirestoreMock();
  assertEquals(await checkAndReserve("5551230004", db), true);
  assertEquals(await checkAndReserve("5551230005", db), true);
});

Deno.test("release: clears a reservation so the phone can be reserved again", async () => {
  const db = new FirestoreMock();
  const phone = "5551230006";
  await reserve(phone, db);
  assertEquals(await checkOnly(phone, db), false);
  await release(phone, db);
  // After release the phone is free again (e.g. Bland send failed → rollback).
  assertEquals(await checkOnly(phone, db), true);
  assertEquals(await checkAndReserve(phone, db), true);
});
