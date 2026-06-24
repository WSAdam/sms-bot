// Guards the dedup-guard orderBy fix. handleDelayedInjection queries
// injectionhistory for recent fires (limit 5) to decide whether to block a
// re-dial. Without orderBy, Firestore returns 5 entries in document-ID order —
// so for a phone with 6+ history docs, the MOST RECENT fire could fall outside
// the returned slice, the guard would read an older firedAt, and it would
// permit a DUPLICATE dial. Adding orderBy:{firedAt,desc} guarantees the 5 most
// recent entries are evaluated.

import { assertEquals } from "@std/assert";
import { injectionHistoryDocPath } from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { handleDelayedInjection } from "@shared/services/orchestrator/queue.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("dedup guard evaluates the MOST RECENT fire even with 6+ history docs (orderBy desc)", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551237777";
    const now = Date.now();
    const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();

    // 5 OLD fires (well outside the 72h dedup window). Their doc IDs sort
    // FIRST lexicographically ("aaa00".."aaa04"), so a no-orderBy limit-5
    // query would return exactly these and miss the recent one below.
    for (let i = 0; i < 5; i++) {
      mock.docs.set(injectionHistoryDocPath(`aaa0${i}`), {
        phone,
        firedAt: hoursAgo(200 + i), // ~8+ days ago
        status: "success",
      });
    }
    // 1 RECENT fire (1h ago, inside the 72h window). Its doc ID sorts LAST,
    // so it would be dropped by a limit-5 query without orderBy.
    mock.docs.set(injectionHistoryDocPath("zzz99"), {
      phone,
      firedAt: hoursAgo(1),
      status: "success",
    });

    const r = await handleDelayedInjection(phone);
    // The guard must see the 1h-ago fire and SKIP the re-dial.
    assertEquals(r.skipped, true);
  } finally {
    setFirestoreClientForTests(null);
  }
});
