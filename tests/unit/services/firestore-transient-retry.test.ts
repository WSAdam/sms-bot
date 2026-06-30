// Guards the Firestore wrapper's transient-read retry (incident 2026-06-29). A
// single `getaddrinfo EAI_AGAIN` on Deno Deploy's REST transport bubbled to
// gates-config and disarmed the injection sweep. get()/list() now retry
// idempotent reads on transient network errors so a blip never reaches callers.

import { assert, assertEquals, assertRejects } from "@std/assert";
import {
  isTransientFirestoreError,
  withTransientRetry,
} from "@core/data/firestore-wrapper/mod.ts";

Deno.test("isTransientFirestoreError: DNS/socket blips are transient; logical errors are not", () => {
  // Transient — safe to retry.
  assert(isTransientFirestoreError({ code: "EAI_AGAIN" }));
  assert(isTransientFirestoreError({ errno: "ECONNRESET" }));
  assert(isTransientFirestoreError({ code: "UNAVAILABLE" }));
  assert(
    isTransientFirestoreError(
      new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
    ),
  );
  assert(isTransientFirestoreError(new Error("socket hang up")));

  // Logical / permanent — must NOT be retried (would just waste time or mask a
  // real failure).
  assert(!isTransientFirestoreError({ code: "PERMISSION_DENIED" }));
  assert(!isTransientFirestoreError(new Error("Document does not exist")));
  assert(!isTransientFirestoreError(null));
  assert(!isTransientFirestoreError(undefined));
});

Deno.test("withTransientRetry: retries a transient failure, then succeeds", async () => {
  let calls = 0;
  const result = await withTransientRetry("test-get", () => {
    calls++;
    if (calls < 3) return Promise.reject(new Error("EAI_AGAIN"));
    return Promise.resolve("ok");
  }, 3);
  assertEquals(result, "ok");
  assertEquals(calls, 3); // failed twice, succeeded on the third
});

Deno.test("withTransientRetry: a non-transient error fails fast (no retries)", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      withTransientRetry("test-get", () => {
        calls++;
        return Promise.reject(new Error("PERMISSION_DENIED"));
      }, 3),
    Error,
    "PERMISSION_DENIED",
  );
  assertEquals(calls, 1); // gave up immediately, didn't retry
});

Deno.test("withTransientRetry: gives up after the attempt budget on sustained transient failure", async () => {
  let calls = 0;
  await assertRejects(
    () =>
      withTransientRetry("test-get", () => {
        calls++;
        return Promise.reject(new Error("ECONNRESET"));
      }, 2),
    Error,
    "ECONNRESET",
  );
  assertEquals(calls, 2); // exactly `attempts` tries, then propagates
});
