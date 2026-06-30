// Guards the DNC fail-safe / compliance error handling.
//   - isDnc() fails CLOSED on a read error (returns TRUE = treat as opted-out).
//     Contacting a DNC/TCPA opt-out is a compliance violation, so when we can't
//     confirm we must NOT contact. (It briefly failed OPEN, which let an
//     opted-out phone slip past the gatekeeper during a Firestore blip — the
//     compliance exposure this pins shut.) It also bumps a best-effort
//     dncReadFailures counter and never throws.
//   - markDnc() retries the idempotent write on transient errors and RETURNS
//     whether the flag landed (true/false), never throwing — so /sms-callback/stop
//     and the conversation webhook can 502 to force a retry on a lost opt-out.

import { assert, assertEquals } from "@std/assert";
import { isDnc, markDnc } from "@sms-flow/domain/business/dnc/mod.ts";
import type { FirestoreClient } from "@shared/firestore/wrapper.ts";

function throwingGetClient(): FirestoreClient {
  return {
    get: () =>
      Promise.reject(
        new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
      ),
    // isDnc bumps a best-effort counter in its catch; mid-outage that write
    // would also fail (swallowed). Provide it so the stub matches the real API.
    incrementField: () => Promise.reject(new Error("EAI_AGAIN")),
  } as unknown as FirestoreClient;
}

Deno.test("isDnc: Firestore read failure → fail-CLOSED (returns true, treat as DNC), warns, no throw", async () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  try {
    const result = await isDnc("5551230001", throwingGetClient());
    assertEquals(
      result,
      true,
      "must fail CLOSED — contacting a DNC/TCPA opt-out we can't confirm is a compliance violation",
    );
    assert(warned, "isDnc should warn on read failure");
  } finally {
    console.warn = original;
  }
});

Deno.test("markDnc: write success → returns true", async () => {
  const ok = { set: () => Promise.resolve() } as unknown as FirestoreClient;
  assertEquals(await markDnc("5551230001", "STOP", ok), true);
});

Deno.test("markDnc: sustained write failure (after retries) → returns false, warns, does not throw", async () => {
  const original = console.warn;
  let warned = false;
  console.warn = () => {
    warned = true;
  };
  const throwingSet = {
    set: () =>
      Promise.reject(
        new Error("getaddrinfo EAI_AGAIN firestore.googleapis.com"),
      ),
  } as unknown as FirestoreClient;
  try {
    const result = await markDnc("5551230001", "STOP", throwingSet);
    assertEquals(
      result,
      false,
      "a write that fails through all retries returns false so the route can 502 (force a re-mark) instead of a false success",
    );
    assert(warned, "markDnc should warn on write failure");
  } finally {
    console.warn = original;
  }
});

Deno.test("markDnc: a transient write that recovers on retry → returns true (no lost opt-out)", async () => {
  let calls = 0;
  const flaky = {
    set: () => {
      calls++;
      return calls < 2
        ? Promise.reject(new Error("ECONNRESET"))
        : Promise.resolve();
    },
  } as unknown as FirestoreClient;
  assertEquals(await markDnc("5551230001", "STOP", flaky), true);
  assert(calls >= 2, "the transient failure must have been retried");
});
