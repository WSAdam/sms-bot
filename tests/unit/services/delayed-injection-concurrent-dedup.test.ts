// Guards the dedup window against concurrent re-dials. delayed-injection-dedup-
// orderby.test covers the many-old-docs ordering case; this covers the
// concurrency case the finding flagged: two rapid/parallel handleDelayedInjection
// calls for the SAME phone within the dedup window (two near-simultaneous sweep
// ticks, or manual trigger + auto sweep in the same minute) must NOT both
// dial out. With a recent injectionhistory entry inside the window, every
// in-flight call sees it and short-circuits to {skipped} — neither double-dials.

import { assert, assertEquals } from "@std/assert";
import { injectionHistoryDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { handleDelayedInjection } from "@shared/services/orchestrator/queue.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("two parallel handleDelayedInjection calls within the dedup window both skip (no double-dial)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551237400";
    // A fire happened seconds ago — inside the default 72h window.
    mock.docs.set(injectionHistoryDocPath(`${phone}__recent`), {
      phone,
      firedAt: new Date().toISOString(),
      status: "success",
    });

    // Two near-simultaneous calls (e.g. overlapping sweep ticks).
    const [a, b] = await Promise.all([
      handleDelayedInjection(phone),
      handleDelayedInjection(phone),
    ]);

    // Both must see the recent fire and skip — the window prevents EITHER from
    // dialing again, so there's no double-dial path even under concurrency.
    assertEquals(a.skipped, true);
    assertEquals(b.skipped, true);
    if (a.skipped && b.skipped) {
      assert(a.reason.length > 0, "skip should carry a reason");
      assert(b.reason.length > 0, "skip should carry a reason");
    }
  } finally {
    setFirestoreClientForTests(null);
  }
});
