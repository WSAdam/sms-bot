// Guards the DNC fail-safe error handling. Both isDnc() and markDnc() used to
// perform an unguarded Firestore read/write — a transient blip threw all the
// way out:
//   - isDnc() throwing crashed the processInboundLead gatekeeper and returned a
//     500 to ReadyMode, indistinguishable from a normal rejection.
//   - markDnc() throwing in /sms-callback/stop short-circuited the route BEFORE
//     dncGlobal ran, returned a bare 500, never wrote the local DNC flag, and a
//     later trigger's isDnc gate could pass — re-texting an opted-out guest.
// The fix: isDnc fails OPEN (returns false on read error, like
// rate-limiter.checkOnly), markDnc is fire-and-forget on write error (like
// rate-limiter.release). Neither throws.

import { assert, assertEquals } from "@std/assert";
import { isDnc, markDnc } from "@sms-flow/domain/business/dnc/mod.ts";
import type { FirestoreClient } from "@shared/firestore/wrapper.ts";

function throwingGetClient(): FirestoreClient {
  return {
    get: () =>
      Promise.reject(
        new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
      ),
  } as unknown as FirestoreClient;
}

function throwingSetClient(): FirestoreClient {
  return {
    set: () =>
      Promise.reject(
        new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
      ),
  } as unknown as FirestoreClient;
}

Deno.test("isDnc: Firestore read failure → fail-open (returns false), does not throw", async () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    const result = await isDnc("5551230001", throwingGetClient());
    assertEquals(result, false, "must fail-open so a blip != opted-out crash");
    assert(warned, "isDnc should warn on read failure");
  } finally {
    console.warn = original;
  }
});

Deno.test("markDnc: Firestore write failure → swallows + warns, does not throw", async () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    // Must resolve, not reject. The /sms-callback/stop route relies on this so
    // the subsequent dncGlobal()→502 path still runs.
    await markDnc("5551230001", "STOP", throwingSetClient());
    assert(warned, "markDnc should warn on write failure");
  } catch (e) {
    throw new Error(`markDnc must not throw on Firestore failure: ${e}`);
  } finally {
    console.warn = original;
  }
});
