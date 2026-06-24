// Guards the delayed-injection metadata-write fix. After injectLead() succeeds
// in handleDelayedInjection, the orchestrator.logEvent() + updatePointer()
// calls used to be UNPROTECTED — a Firestore failure there propagated to the
// sweep's catch, which recorded the injectionhistory entry as status='error'
// even though ReadyMode already received the injection (and the
// scheduledinjection was already removed). The fix wraps those two calls in
// their own try-catch so a metadata-write failure can't flip an
// already-successful injection to error: it must still return { skipped: false }.

import { assertEquals } from "@std/assert";
import { handleDelayedInjection } from "@sms-flow/domain/business/delayed-injection/mod.ts";
import { leadPointerDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { _clearGatesConfigCache } from "@core/business/gates-config/mod.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// A FirestoreMock whose pointer transactionalUpdate throws on the Nth call.
// injectLead writes the pointer once on success (#1); handleDelayedInjection's
// own updatePointer is the SECOND pointer write (#2) — failing it simulates a
// post-inject metadata failure with the inject already done.
class PointerFailMock extends FirestoreMock {
  private pointerWrites = 0;
  constructor(private failOnPointerWrite: number) {
    super();
  }
  override transactionalUpdate(
    path: string,
    fn: (existing: Record<string, unknown> | null) => Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (path.startsWith(`${leadPointerCollectionPrefix}`)) {
      this.pointerWrites++;
      if (this.pointerWrites === this.failOnPointerWrite) {
        return Promise.reject(new Error("firestore quota exceeded"));
      }
    }
    return super.transactionalUpdate(path, fn);
  }
}

// Derive the pointer collection prefix from a known doc path.
const leadPointerCollectionPrefix = leadPointerDocPath("0000000000").replace(
  "/0000000000",
  "/",
);

Deno.test(
  "handleDelayedInjection: a post-inject orchestrator failure does NOT flip a successful injection to error",
  async () => {
    Deno.env.set("RM_USER", "test-user");
    Deno.env.set("RM_PASS", "test-pass");
    _clearGatesConfigCache();
    const db = new PointerFailMock(2); // fail handleDelayedInjection's updatePointer
    setFirestoreClientForTests(db);

    const original = globalThis.fetch;
    // RM accepts every lead-api inject (preemptive scrub + the inject POST).
    globalThis.fetch = () =>
      Promise.resolve(new Response('{"Success":true}', { status: 200 }));
    try {
      const r = await handleDelayedInjection("9366762277");
      // The inject succeeded at RM; the metadata write failed but was swallowed.
      assertEquals(r, { skipped: false });
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
      _clearGatesConfigCache();
    }
  },
);
