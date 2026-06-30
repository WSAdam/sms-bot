// Guards the shared withCounterFailureFlag helper that centralizes the
// clear-on-success (null) / stamp-on-failure (ISO string) contract for the
// per-day *CounterFailedAt flags the nightly report reads. The three counter
// writers (textsSent / apptsBooked / activations) share it so the null/ISO
// contract can't drift between them, and so a failure re-throws to the caller.

import { assert, assertEquals, assertRejects } from "@std/assert";
import { withCounterFailureFlag } from "@shared/firestore/wrapper.ts";
import { metricsDailyDocPath } from "@shared/firestore/paths.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const DAY1 = metricsDailyDocPath("2026-06-30");
const DAY2 = metricsDailyDocPath("2026-07-01");

Deno.test("withCounterFailureFlag: success clears the flag (null) on every doc", async () => {
  const db = new FirestoreMock();
  // Pre-stamp a stale flag as if a PRIOR run failed.
  await db.setMerge(DAY1, {
    activationsCounterFailedAt: "2026-06-29T00:00:00.000Z",
  });
  let ran = false;
  await withCounterFailureFlag(
    db,
    [DAY1, DAY2],
    "activationsCounterFailedAt",
    () => {
      ran = true;
      return Promise.resolve();
    },
  );
  assert(ran, "the wrapped fn must run");
  assertEquals((await db.get(DAY1))?.activationsCounterFailedAt, null);
  assertEquals((await db.get(DAY2))?.activationsCounterFailedAt, null);
});

Deno.test("withCounterFailureFlag: failure stamps an ISO flag on every doc AND re-throws", async () => {
  const db = new FirestoreMock();
  await assertRejects(
    () =>
      withCounterFailureFlag(
        db,
        [DAY1, DAY2],
        "activationsCounterFailedAt",
        () => Promise.reject(new Error("quota")),
      ),
    Error,
    "quota",
  );
  const f1 = (await db.get(DAY1))?.activationsCounterFailedAt;
  const f2 = (await db.get(DAY2))?.activationsCounterFailedAt;
  assert(
    typeof f1 === "string" && f1.length > 0,
    "DAY1 flag must be an ISO string after failure",
  );
  assert(typeof f2 === "string", "DAY2 flag must be stamped too (multi-day)");
});

Deno.test("withCounterFailureFlag: a single docPath (not array) works", async () => {
  const db = new FirestoreMock();
  await withCounterFailureFlag(
    db,
    DAY1,
    "textsSentCounterFailedAt",
    () => Promise.resolve(),
  );
  assertEquals((await db.get(DAY1))?.textsSentCounterFailedAt, null);
});
