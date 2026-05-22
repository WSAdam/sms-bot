// Concurrency regression test for the daily SMS counter.
//
// Pre-fix this was a read-then-write that lost increments under
// concurrent /trigger/readymode webhooks. With the fix using
// FieldValue.increment (mock simulates atomic increment via a process-
// local mutation lock), N parallel calls always converge to N.
//
// The mock's `incrementField` runs inside `withLock()`, which mirrors
// Firestore's server-side atomicity guarantee from the SDK's POV.

import { assertEquals } from "@std/assert";
import { globalSmsCountDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { increment as incrementSmsCount } from "@shared/services/sms-count/service.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("incrementField is atomic: N parallel calls converge to N", async () => {
  const mock = new FirestoreMock();
  const path = "sms-bot/test/counter";
  const N = 50;

  // Fire all increments in parallel.
  await Promise.all(
    Array.from({ length: N }, () => mock.incrementField(path, { count: 1 })),
  );

  const after = await mock.get(path);
  assertEquals(after?.count, N);
});

Deno.test("incrementField composes with setMerge: parallel + non-atomic merges coexist", async () => {
  // Mirrors the production pattern: incrementField for the counter,
  // setMerge for the updatedAt timestamp. Counter must be exact; the
  // updatedAt is "last writer wins" and benign.
  const mock = new FirestoreMock();
  const path = "sms-bot/test/counter-with-ts";
  const N = 30;

  await Promise.all(
    Array.from({ length: N }, async (_, i) => {
      await mock.incrementField(path, { count: 1 });
      await mock.setMerge(path, { updatedAt: `t-${i}` });
    }),
  );

  const after = await mock.get(path);
  assertEquals(after?.count, N);
  // updatedAt is one of the N values, but we don't care which.
  assertEquals(typeof after?.updatedAt, "string");
});

Deno.test("sms-count increment under parallel load doesn't lose updates", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const date = "2026-05-21";
    const N = 25;

    await Promise.all(
      Array.from({ length: N }, () => incrementSmsCount(date, mock)),
    );

    const final = await mock.get(globalSmsCountDocPath(date));
    assertEquals(final?.count, N);
  } finally {
    setFirestoreClientForTests(null);
  }
});
