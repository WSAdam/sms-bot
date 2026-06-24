// Guards the conversation webhook all-DNC-fail fix. On a doNotText opt-out the
// route DNCs the phone in every ReadyMode domain and embedded the results in a
// status:"success" HTTP 200 response with no all-failed check. When ReadyMode is
// unreachable, dncGlobal reports every domain as Failed/Error yet the caller
// still saw 200 "success" — the opt-out looked applied while the guest stayed in
// active campaigns. This is the unfixed twin of /stop's all-failed → 502 check.

import { assertEquals } from "@std/assert";
import { handler } from "@/routes/sms-callback/conversation/[phone]/[callId].ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function call(
  phone: string,
  callId: string,
  body: unknown,
): Promise<Response> {
  const req = new Request(
    `http://x/sms-callback/conversation/${phone}/${callId}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    },
  );
  // The handler touches ctx.req and ctx.params.
  // deno-lint-ignore no-explicit-any
  const post = (handler as any).POST as (ctx: unknown) => Promise<Response>;
  return post({ req, params: { phone, callId } });
}

function withStubFetch(
  response: () => Response,
  body: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    setFirestoreClientForTests(new FirestoreMock());
    globalThis.fetch = () => Promise.resolve(response());
    try {
      await body();
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
    }
  };
}

Deno.test(
  "conversation webhook: doNotText opt-out returns 502 when EVERY domain fails to DNC",
  withStubFetch(
    // RM HTTP-200 {"Success":false} → dncLead reports Failed for every domain.
    () => new Response('{"Success":false}', { status: 200 }),
    async () => {
      const res = await call("9366762277", "conv-1", {
        sender: "USER",
        message: "STOP",
        doNotText: true,
      });
      assertEquals(res.status, 502);
      const json = await res.json();
      assertEquals(json.status, "error");
    },
  ),
);

Deno.test(
  "conversation webhook: doNotText opt-out returns 200 success when ReadyMode DNC succeeds",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async () => {
      const res = await call("9366762277", "conv-2", {
        sender: "USER",
        message: "STOP",
        doNotText: true,
      });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.status, "success");
    },
  ),
);

Deno.test(
  "conversation webhook: a normal (no doNotText) message returns 200 success, no DNC attempted",
  withStubFetch(
    // Even if RM would report Failed, no DNC runs without doNotText, so the
    // all-failed branch must not fire on an ordinary inbound message.
    () => new Response('{"Success":false}', { status: 200 }),
    async () => {
      const res = await call("9366762277", "conv-3", {
        sender: "USER",
        message: "hi there",
      });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.status, "success");
    },
  ),
);
