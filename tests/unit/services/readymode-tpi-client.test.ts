// Unit tests for the RM TPI client. Two layers:
//   1. Pure parsers: pickBiggestLeadId, extractTimesCalled.
//   2. Throttle / circuit behavior in fetchAttemptsFromTpi, via fetch stub.

import { assertEquals } from "@std/assert";
import {
  __resetTpiStateForTests,
  extractTimesCalled,
  fetchAttemptsFromTpi,
  getTpiThrottleSnapshot,
  pickBiggestLeadId,
} from "@shared/services/readymode/tpi-client.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

// Stub fetch + RM creds before every test. The client reads creds via
// Deno.env, so we set the env var here too. Real fetch is restored after.

function withStubFetch(
  handler: (url: string) => Response | Promise<Response>,
  body: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    __resetTpiStateForTests();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      return await handler(url);
    };
    try {
      await body();
    } finally {
      globalThis.fetch = original;
    }
  };
}

function jsonResponse(obj: unknown, status = 200): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// ---- Pure parser tests --------------------------------------------------

Deno.test("pickBiggestLeadId picks max itemId among typeId=Lead", () => {
  const resp = {
    "Profile,293847": { typeId: "Profile", itemId: "293847" },
    "Lead,1766": { typeId: "Lead", itemId: "1766" },
    "Lead,2391391": { typeId: "Lead", itemId: "2391391" },
    "Lead,1234": { typeId: "Lead", itemId: "1234" },
  };
  assertEquals(pickBiggestLeadId(resp), 2391391);
});

Deno.test("pickBiggestLeadId returns null when no Leads present", () => {
  const resp = {
    "Profile,1": { typeId: "Profile", itemId: "1" },
    "Profile,2": { typeId: "Profile", itemId: "2" },
  };
  assertEquals(pickBiggestLeadId(resp), null);
});

Deno.test("pickBiggestLeadId tolerates numeric itemId", () => {
  const resp = {
    "Lead,1": { typeId: "Lead", itemId: 1 },
    "Lead,99": { typeId: "Lead", itemId: 99 },
  };
  assertEquals(pickBiggestLeadId(resp), 99);
});

Deno.test("extractTimesCalled reads result['times called']", () => {
  const resp = {
    result: { "times called": 7, status_time: "ignored" },
  };
  assertEquals(extractTimesCalled(resp), 7);
});

Deno.test("extractTimesCalled tolerates string integer", () => {
  const resp = { result: { "times called": "12" } };
  assertEquals(extractTimesCalled(resp), 12);
});

Deno.test("extractTimesCalled rejects missing or non-int", () => {
  assertEquals(extractTimesCalled({ result: {} }), null);
  assertEquals(extractTimesCalled({ result: { "times called": "abc" } }), null);
  assertEquals(extractTimesCalled({ result: { "times called": -3 } }), null);
  assertEquals(extractTimesCalled({}), null);
});

// ---- Throttle / circuit tests -------------------------------------------

Deno.test(
  "happy path: search + get returns attempts",
  withStubFetch(
    (url) => {
      if (url.includes("/TPI/search/lead/")) {
        return jsonResponse({
          "Lead,2391391": { typeId: "Lead", itemId: "2391391" },
        });
      }
      if (url.includes("/TPI/get/lead/")) {
        return jsonResponse({
          result: { "times called": 7 },
        });
      }
      return new Response("unexpected", { status: 500 });
    },
    async () => {
      const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
      assertEquals(r.ok, true);
      if (r.ok) {
        assertEquals(r.attempts, 7);
        assertEquals(r.leadId, 2391391);
      }
    },
  ),
);

Deno.test(
  "search response with no leads → no-lead-in-rm (no failure recorded)",
  withStubFetch(
    () =>
      jsonResponse({
        "Profile,1": { typeId: "Profile", itemId: "1" },
      }),
    async () => {
      const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
      assertEquals(r.ok, false);
      if (!r.ok) assertEquals(r.reason, "no-lead-in-rm");
      // RM responded fine, so the circuit shouldn't have moved.
      assertEquals(getTpiThrottleSnapshot().consecutiveFailures, 0);
    },
  ),
);

Deno.test(
  "get response missing times-called → no-times-called-field",
  withStubFetch(
    (url) => {
      if (url.includes("/TPI/search/lead/")) {
        return jsonResponse({
          "Lead,1": { typeId: "Lead", itemId: "1" },
        });
      }
      return jsonResponse({ result: {} });
    },
    async () => {
      const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
      assertEquals(r.ok, false);
      if (!r.ok) assertEquals(r.reason, "no-times-called-field");
    },
  ),
);

Deno.test(
  "5 consecutive 5xx → circuit opens; 6th call returns tpi-circuit-open without fetch",
  withStubFetch(
    () => new Response("err", { status: 500 }),
    async () => {
      // Drive 5 failures.
      for (let i = 0; i < 5; i++) {
        const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
        assertEquals(r.ok, false);
      }
      const snap = getTpiThrottleSnapshot();
      assertEquals(snap.circuitOpen, true);

      // 6th call: should short-circuit BEFORE fetching. Swap the stub
      // to throw if called — proves we never hit fetch.
      let fetchedAgain = false;
      const original = globalThis.fetch;
      globalThis.fetch = (() => {
        fetchedAgain = true;
        return Promise.resolve(new Response("nope", { status: 200 }));
      }) as typeof globalThis.fetch;
      try {
        const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
        assertEquals(r.ok, false);
        if (!r.ok) assertEquals(r.reason, "tpi-circuit-open");
        assertEquals(fetchedAgain, false);
      } finally {
        globalThis.fetch = original;
      }
    },
  ),
);

Deno.test(
  "rejects invalid-phone before throttle/fetch",
  withStubFetch(
    () => new Response("should not be called", { status: 500 }),
    async () => {
      const r = await fetchAttemptsFromTpi("not-a-phone", DialerDomain.ACT);
      assertEquals(r.ok, false);
      if (!r.ok) assertEquals(r.reason, "invalid-phone");
      // No token consumed.
      assertEquals(getTpiThrottleSnapshot().callsInWindow, 0);
    },
  ),
);

Deno.test(
  "5-min sliding window cap fires once we exceed the limit",
  async () => {
    // Lower the cap via env to keep the test fast.
    const original = globalThis.fetch;
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    Deno.env.set("RM_TPI_MAX_PER_5MIN", "2");
    Deno.env.set("RM_TPI_MIN_SPACING_MS", "0");

    // Module already initialized with old env values — to actually test
    // the cap with fresh consts we'd need to re-import. Instead, exercise
    // the BEHAVIOR with the default cap of 30 by hammering more than 30.
    // (Skip env re-init complexity; the constant is captured at import.)
    Deno.env.delete("RM_TPI_MAX_PER_5MIN");
    Deno.env.delete("RM_TPI_MIN_SPACING_MS");

    __resetTpiStateForTests();
    globalThis.fetch = async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input.toString();
      if (url.includes("/TPI/search/lead/")) {
        return jsonResponse({
          "Lead,1": { typeId: "Lead", itemId: "1" },
        });
      }
      return jsonResponse({ result: { "times called": 1 } });
    };
    try {
      let capHit = false;
      for (let i = 0; i < 35; i++) {
        const r = await fetchAttemptsFromTpi("8432222986", DialerDomain.ACT);
        if (!r.ok && r.reason === "tpi-window-cap-reached") {
          capHit = true;
          break;
        }
      }
      assertEquals(capHit, true, "expected window cap to trip within 35 calls");
    } finally {
      globalThis.fetch = original;
    }
  },
);
