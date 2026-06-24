// Covers two ReadyMode "phantom success" + correctness fixes in lead-service:
//
//  1. dncLead reported success on RM rejection via a loose includes("Success")
//     || res.ok check — {"Success":false} on an HTTP 200 was read as success.
//     The fix requires an affirmative Success:true with no explicit rejection.
//     We exercise it via dncGlobal (the exported surface that calls dncLead per
//     domain).
//
//  2. scrubLead normalized the RM phone with a blind .slice(-10) that could
//     scrub a DIFFERENT number for malformed input. The fix routes through
//     normalizePhone() and bails (returns false, no scrub fetch) when it can't
//     parse a real 10-digit number — and emits the normalized 10-digit number
//     for valid input.

import { assert, assertEquals } from "@std/assert";
import {
  dncGlobal,
  scrubLead,
} from "@dialer/domain/business/lead-service/mod.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// scrubLead logs a SCRUB event through the orchestrator on success, which
// needs a Firestore client — wire the in-memory mock so the happy path
// doesn't fall into the catch (which would mask a real verdict with `false`).
setFirestoreClientForTests(new FirestoreMock());

// Stub fetch + RM creds for a test body. Captures every outbound request so we
// can assert on the URL-encoded body. Real fetch is restored afterward.
function withStubFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
  body: (calls: Array<{ url: string; init?: RequestInit }>) => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    globalThis.fetch = (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input.toString();
      calls.push({ url, init });
      return Promise.resolve(handler(url, init));
    };
    try {
      await body(calls);
    } finally {
      globalThis.fetch = original;
    }
  };
}

function bodyText(init?: RequestInit): string {
  const b = init?.body;
  return typeof b === "string" ? b : "";
}

Deno.test(
  'dncGlobal: RM HTTP-200 {"Success":false} is reported as Failed, not Success',
  withStubFetch(
    () => new Response('{"Success":false}', { status: 200 }),
    async () => {
      const results = await dncGlobal("9366762277");
      // Every domain attempted; NONE may be reported as Success on a rejection.
      assert(Object.keys(results).length > 0, "dncGlobal attempted ≥1 domain");
      for (const [domain, status] of Object.entries(results)) {
        assertEquals(status, "Failed", `${domain} must not phantom-succeed`);
      }
    },
  ),
);

Deno.test(
  'dncGlobal: RM HTTP-200 {"Success":true} is reported as Success',
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async () => {
      const results = await dncGlobal("9366762277");
      for (const [domain, status] of Object.entries(results)) {
        assertEquals(status, "Success", `${domain} should be Success`);
      }
    },
  ),
);

Deno.test(
  "scrubLead: emits the NORMALIZED 10-digit phone for an 11-digit (+1) input",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async (calls) => {
      const ok = await scrubLead("+1 (936) 676-2277", DialerDomain.MONSTER);
      assertEquals(ok, true);
      assertEquals(calls.length, 1);
      const body = bodyText(calls[0].init);
      // lead[phone] must be the normalized last-10, URL-encoded as lead%5Bphone%5D.
      assert(
        body.includes("lead%5Bphone%5D=9366762277"),
        `expected normalized 10-digit phone in body, got: ${body}`,
      );
    },
  ),
);

Deno.test(
  "scrubLead: bails (no fetch, returns false) on an unparseable phone instead of scrubbing a wrong number",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async (calls) => {
      // 12 digits not starting with a single leading 1 → normalizePhone returns
      // null. A blind slice(-10) would have scrubbed "3456789012" (a DIFFERENT
      // number); the fix refuses and never issues the scrub.
      const ok = await scrubLead("123456789012", DialerDomain.MONSTER);
      assertEquals(ok, false);
      assertEquals(calls.length, 0, "must not call RM with a guessed number");
    },
  ),
);

Deno.test(
  "scrubLead: unparseable phone BUT a leadId present → degrades to scrub-by-leadId (does NOT bail)",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async (calls) => {
      // handleDuplicate passes BOTH lead.phone and the parsed leadId. When the
      // phone can't be normalized, the scrub must still run keyed by leadId —
      // bailing entirely here is what surfaced "Scrub Failed" in the
      // duplicate-handler retry flow even though the leadId scrub would succeed.
      const ok = await scrubLead("abc123", DialerDomain.MONSTER, "456");
      assertEquals(ok, true, "leadId scrub should succeed");
      assertEquals(calls.length, 1, "must issue the scrub keyed by leadId");
      const body = bodyText(calls[0].init);
      // No guessed phone may be sent; the leadId must be.
      assert(
        !body.includes("lead%5Bphone%5D"),
        `must NOT send a guessed phone, got: ${body}`,
      );
      assert(
        body.includes("lead%5BleadId%5D=456"),
        `expected leadId in body, got: ${body}`,
      );
    },
  ),
);

Deno.test(
  "scrubLead: no phone AND no leadId → bails (no fetch, returns false)",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async (calls) => {
      const ok = await scrubLead("", DialerDomain.MONSTER);
      assertEquals(ok, false);
      assertEquals(calls.length, 0, "no identifier → never call RM");
    },
  ),
);

Deno.test(
  "scrubLead: parseable phone AND leadId → sends BOTH (normalized phone + leadId)",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async (calls) => {
      const ok = await scrubLead(
        "+1 (936) 676-2277",
        DialerDomain.MONSTER,
        "789",
      );
      assertEquals(ok, true);
      assertEquals(calls.length, 1);
      const body = bodyText(calls[0].init);
      assert(
        body.includes("lead%5Bphone%5D=9366762277"),
        `expected normalized phone, got: ${body}`,
      );
      assert(
        body.includes("lead%5BleadId%5D=789"),
        `expected leadId, got: ${body}`,
      );
    },
  ),
);
