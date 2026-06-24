// Guards the /stop endpoint DNC-failure fix. The handler computed dncResults
// via dncGlobal (which never throws — it returns a per-domain Success/Failed/
// Error map) and then ALWAYS returned HTTP 200 status='success'. If every
// domain failed to DNC in ReadyMode, the caller still saw success and assumed
// the lead was protected when it wasn't. The fix returns 502 when every domain
// reports Failed/Error (the local opt-out is already recorded either way),
// consistent with disposition.ts / return-to-source.ts.

import { assertEquals } from "@std/assert";
import { handler } from "@/routes/sms-callback/stop.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

function call(body: unknown): Promise<Response> {
  const req = new Request("http://x/sms-callback/stop", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // The handler only touches ctx.req.
  // deno-lint-ignore no-explicit-any
  return (handler as any).POST({ req } as any);
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
  "/stop: returns 502 when EVERY domain fails to DNC in ReadyMode",
  withStubFetch(
    // RM HTTP-200 {"Success":false} → dncLead reports Failed for every domain.
    () => new Response('{"Success":false}', { status: 200 }),
    async () => {
      const res = await call({ phone: "9366762277" });
      assertEquals(res.status, 502);
      const json = await res.json();
      assertEquals(json.status, "error");
    },
  ),
);

Deno.test(
  "/stop: returns 200 success when ReadyMode DNC succeeds",
  withStubFetch(
    () => new Response('{"Success":true}', { status: 200 }),
    async () => {
      const res = await call({ phone: "9366762277" });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.status, "success");
    },
  ),
);
