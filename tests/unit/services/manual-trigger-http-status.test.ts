// Guards the /trigger/manual HTTP-status fix. The handler used to return
// Response.json(r) unconditionally — even when processInboundLead returned
// {status:"error"} (e.g. missing phone, or a Bland failure with override=true),
// the HTTP status was still 200, so callers/the test UI couldn't distinguish
// success from failure by status code. readymode.ts already maps error→400; the
// manual route now mirrors that.

import { assertEquals } from "@std/assert";
import { handler } from "@/routes/trigger/manual.ts";

function call(body: unknown): Promise<Response> {
  const req = new Request("http://x/trigger/manual", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // The handler only touches ctx.req.
  // deno-lint-ignore no-explicit-any
  return (handler as any).POST({ req } as any);
}

Deno.test(
  "/trigger/manual: missing phone → processInboundLead error → HTTP 400 (not 200)",
  async () => {
    // No phone (and no resID) makes processInboundLead return {status:"error",
    // message:"Missing phone number"} BEFORE any gate/Firestore/Bland call, so
    // this exercises the status mapping without external deps. override defaults
    // to true here, proving the error still surfaces as 400 even on override.
    const res = await call({ foo: "bar" });
    assertEquals(res.status, 400);
    const json = await res.json();
    assertEquals(json.status, "error");
  },
);
