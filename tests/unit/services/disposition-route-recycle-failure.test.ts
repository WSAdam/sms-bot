// Guards the /disposition standard-recycle branch fix. The branch called
// injectLead() then returned Response.json({ status: result.status, ... }) with
// NO status check — injectLead returns { status: "error" } WITHOUT throwing on
// an RM rejection (HTTP 200 + Accepted:false), so the endpoint responded HTTP
// 200 with status='error' in the body. The Bland webhook treats 200 as success
// and never retries, so the lead was silently lost from recycling. The fix
// returns 502 on a non-success inject, mirroring the ODR-return branch.

import { assert, assertEquals } from "@std/assert";
import { handler } from "@/routes/sms-callback/disposition.ts";
import { CAMPAIGN_MASTER_MAP } from "@dialer/domain/business/campaigns/mod.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const SOURCE = "__test_recycle_source__";
const TARGET = "__test_recycle_target__";

function call(body: unknown): Promise<Response> {
  const req = new Request("http://x/sms-callback/disposition", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  // deno-lint-ignore no-explicit-any
  return (handler as any).POST({ req } as any);
}

Deno.test(
  "/disposition recycle branch: returns 502 (not 200) when the recycle inject fails at RM",
  async () => {
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    setFirestoreClientForTests(new FirestoreMock());
    // Inject a source campaign that recycles into a target. (No real campaign
    // carries a recycleTarget today, so the branch is otherwise unreachable.)
    CAMPAIGN_MASTER_MAP[SOURCE] = {
      id: "src-id",
      domain: DialerDomain.MONSTER,
      name: SOURCE,
      recycleTarget: TARGET,
    };
    CAMPAIGN_MASTER_MAP[TARGET] = {
      id: "tgt-id",
      domain: DialerDomain.MONSTER,
      name: TARGET,
      recycleTarget: "",
    };

    const original = globalThis.fetch;
    // Every RM call returns an explicit rejection — injectLead → status:"error".
    globalThis.fetch = () =>
      Promise.resolve(
        new Response('{"0":{"Success":false,"Accepted":false}}', {
          status: 200,
        }),
      );
    try {
      const res = await call({
        phone: "9366762277",
        campaign_name: SOURCE,
        disposition: "Manual Return",
      });
      assertEquals(res.status, 502);
      const json = await res.json();
      assertEquals(json.status, "error");
      assert(
        String(json.message).includes(TARGET),
        "message names the recycle target",
      );
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
      delete CAMPAIGN_MASTER_MAP[SOURCE];
      delete CAMPAIGN_MASTER_MAP[TARGET];
    }
  },
);

Deno.test(
  "/disposition recycle branch: returns 200 success when the recycle inject succeeds",
  async () => {
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    setFirestoreClientForTests(new FirestoreMock());
    CAMPAIGN_MASTER_MAP[SOURCE] = {
      id: "src-id",
      domain: DialerDomain.MONSTER,
      name: SOURCE,
      recycleTarget: TARGET,
    };
    CAMPAIGN_MASTER_MAP[TARGET] = {
      id: "tgt-id",
      domain: DialerDomain.MONSTER,
      name: TARGET,
      recycleTarget: "",
    };

    const original = globalThis.fetch;
    globalThis.fetch = () =>
      Promise.resolve(new Response('{"Success":true}', { status: 200 }));
    try {
      const res = await call({
        phone: "9366762277",
        campaign_name: SOURCE,
        disposition: "Manual Return",
      });
      assertEquals(res.status, 200);
      const json = await res.json();
      assertEquals(json.status, "success");
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
      delete CAMPAIGN_MASTER_MAP[SOURCE];
      delete CAMPAIGN_MASTER_MAP[TARGET];
    }
  },
);
