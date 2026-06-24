// Guards the reseed doc-ID collision fix. reseedOne wrote conversation
// messages with doc ID `phone10__callId__ts`. When Bland returns two messages
// with identical created_at (1-second granularity), both got the SAME doc ID
// and the second batch-write silently overwrote the first — losing a message.
// The fix appends the per-message index, matching ingestBlandTranscript.

import { assert, assertEquals } from "@std/assert";
import { reseedMessageDocId } from "@messaging/domain/business/reseed/mod.ts";

Deno.test("reseedMessageDocId: two messages sharing a timestamp get DISTINCT ids", () => {
  const ts = "2026-06-24T15:30:00.000Z";
  const id0 = reseedMessageDocId("9366762277", "call-1", ts, 0);
  const id1 = reseedMessageDocId("9366762277", "call-1", ts, 1);
  assert(id0 !== id1, "same-timestamp messages must not collide on one doc id");
  assertEquals(id0, "9366762277__call-1__2026-06-24T15:30:00.000Z__0");
  assertEquals(id1, "9366762277__call-1__2026-06-24T15:30:00.000Z__1");
});

Deno.test("reseedMessageDocId: differing timestamps remain distinct", () => {
  const a = reseedMessageDocId(
    "9366762277",
    "call-1",
    "2026-06-24T15:30:00.000Z",
    0,
  );
  const b = reseedMessageDocId(
    "9366762277",
    "call-1",
    "2026-06-24T15:30:01.000Z",
    1,
  );
  assert(a !== b);
});
