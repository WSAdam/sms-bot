// Guards the injectLead post-success orchestrator fix. After RM confirms a
// lead was created, injectLead writes two AUDIT records (orchestrator.logEvent
// + updatePointer). Those writes used to live inside the SAME try-catch whose
// catch re-throws as "Injection Failed". If Firestore rejected the metadata
// writes, injectLead THREW instead of returning {status:"success"} — and its
// callers (return-to-source.ts, bland-talk-now.ts) don't wrap injectLead and
// rely on result.status, so the throw crashed their handlers (and, in talk-now,
// also misreported a real inject as failed). The fix wraps the post-inject
// writes in their own try-catch and still returns success.

import { assertEquals } from "@std/assert";
import { injectLead } from "@dialer/domain/business/lead-service/mod.ts";
import {
  DialerDomain,
  type ReadymodeLeadDto,
} from "@shared/types/readymode.ts";
import {
  type FirestoreClient,
  setFirestoreClientForTests,
} from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// A Firestore client that rejects every write the post-inject audit path uses
// (orchestrator.logEvent → set, updatePointer → transactionalUpdate), while
// reads still work. Models "Firestore writes are failing" without affecting the
// RM HTTP inject itself.
class WriteFailingFirestore extends FirestoreMock {
  override set(): Promise<void> {
    return Promise.reject(new Error("firestore set rejected"));
  }
  override transactionalUpdate(): Promise<Record<string, unknown>> {
    return Promise.reject(new Error("firestore txn rejected"));
  }
}

function withStubFetch(
  client: FirestoreClient,
  response: () => Response,
  body: () => Promise<void>,
): () => Promise<void> {
  return async () => {
    const original = globalThis.fetch;
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    setFirestoreClientForTests(client);
    globalThis.fetch = () => Promise.resolve(response());
    try {
      await body();
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
    }
  };
}

const LEAD: ReadymodeLeadDto = { phone: "9366762277" };

Deno.test(
  "injectLead: a post-inject metadata write failure does NOT throw — returns success",
  withStubFetch(
    new WriteFailingFirestore(),
    // RM confirms the lead was created on every call (preemptive scrub + inject).
    () => new Response('{"Success":true}', { status: 200 }),
    async () => {
      // Before the fix, the orchestrator writes threw inside the outer try-catch
      // and injectLead re-threw "Injection Failed". After the fix the audit
      // writes are best-effort and the verdict still reflects the real inject.
      const result = await injectLead(LEAD, DialerDomain.ODR, "campaign-x");
      assertEquals(result.status, "success");
      assertEquals(result.message, "Injected");
    },
  ),
);

Deno.test(
  "injectLead: with healthy Firestore the success path still returns success",
  withStubFetch(
    new FirestoreMock(),
    () => new Response('{"Success":true}', { status: 200 }),
    async () => {
      const result = await injectLead(LEAD, DialerDomain.ODR, "campaign-x");
      assertEquals(result.status, "success");
    },
  ),
);
