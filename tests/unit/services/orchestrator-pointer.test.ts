// Concurrency regression test for orchestrator.updatePointer.
//
// Pre-fix updatePointer did a read-then-write outside a transaction —
// concurrent disposition + appt-booked webhooks for the same phone
// could lose each other's field updates (the loser's read happens
// before the winner's write, so the loser's write overwrites the
// winner's). With the fix using transactionalUpdate (mock simulates
// atomicity via a process-local mutation lock), parallel updates
// merge correctly.

import { assertEquals } from "@std/assert";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { updatePointer } from "@shared/services/orchestrator/service.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

Deno.test("updatePointer: parallel updates don't lose each other's fields", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551239876";

    // Two concurrent updates touching DIFFERENT fields. Pre-fix, one
    // would overwrite the other's field; with the transaction both
    // survive in the merged doc.
    await Promise.all([
      updatePointer(
        phone,
        {
          currentLocation: {
            domain: DialerDomain.ODR,
            campaignId: "ODR_X",
            timestamp: 1,
          },
        },
        mock,
      ),
      updatePointer(
        phone,
        { status: "IN_ODR" },
        mock,
      ),
    ]);

    const final = await mock.get(`sms-bot/leadpointer/byPhone/${phone}`);
    assertEquals(
      (final as { currentLocation?: { domain?: string } } | null)
        ?.currentLocation?.domain,
      "monsterodr",
    );
    assertEquals((final as { status?: string } | null)?.status, "IN_ODR");
    assertEquals((final as { phone?: string } | null)?.phone, phone);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("updatePointer: N parallel status updates converge (last writer wins on the same field)", async () => {
  // For a SAME-field race, the transactional behavior is still
  // "serialized," but the final value is whichever closure ran last.
  // The test here just asserts no exceptions thrown and that the
  // final value is one of the N candidates — i.e. nothing got lost or
  // corrupted by interleaved partial reads.
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const phone = "5551239877";
    const N = 20;
    const candidates = Array.from(
      { length: N },
      (_, i) => `tag-${i}`,
    );

    await Promise.all(
      candidates.map((tag) => updatePointer(phone, { lastAction: tag }, mock)),
    );

    const final = await mock.get(`sms-bot/leadpointer/byPhone/${phone}`);
    const lastAction = (final as { lastAction?: string } | null)?.lastAction;
    assertEquals(typeof lastAction, "string");
    // Final value must be one of the N inputs (no garbage / partial merges).
    assertEquals(candidates.includes(lastAction!), true);
  } finally {
    setFirestoreClientForTests(null);
  }
});
