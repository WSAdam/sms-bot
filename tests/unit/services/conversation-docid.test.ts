// Guards the live-webhook doc-ID collision fix. conversationDocId(phone,
// callId, timestamp) had no per-message discriminator, so two DIFFERENT
// messages (different sender or text) arriving in the same ISO-millisecond
// mapped to one doc ID and the second set() silently overwrote the first —
// data loss. The fix adds a content discriminator (sender+message hash) to the
// id. The legacy 3-arg form is preserved for the legacy-key-map reverse path.

import { assert, assertEquals } from "@std/assert";
import {
  conversationDiscriminator,
  conversationDocId,
} from "@core/business/id/mod.ts";

Deno.test("conversationDocId: 3-arg legacy form is unchanged (no discriminator)", () => {
  assertEquals(
    conversationDocId("9366762277", "call-1", "2026-06-24T15:30:00.000Z"),
    "9366762277__call-1__2026-06-24T15:30:00.000Z",
  );
});

Deno.test("conversationDocId: different messages at the SAME timestamp get DISTINCT ids", () => {
  const ts = "2026-06-24T15:30:00.000Z";
  const a = conversationDocId(
    "9366762277",
    "call-1",
    ts,
    conversationDiscriminator("Guest", "sure"),
  );
  const b = conversationDocId(
    "9366762277",
    "call-1",
    ts,
    conversationDiscriminator("AI Bot", "sure"),
  );
  const c = conversationDocId(
    "9366762277",
    "call-1",
    ts,
    conversationDiscriminator("Guest", "yeah"),
  );
  assert(a !== b, "same-ts different-sender must not collide");
  assert(a !== c, "same-ts different-text must not collide");
  assert(b !== c);
});

Deno.test("conversationDocId: identical (sender,message,ts) is stable/idempotent", () => {
  const ts = "2026-06-24T15:30:00.000Z";
  const disc = conversationDiscriminator("Guest", "sure");
  assertEquals(
    conversationDocId("9366762277", "call-1", ts, disc),
    conversationDocId("9366762277", "call-1", ts, disc),
  );
});

Deno.test("conversationDiscriminator: filesystem/Firestore-safe (no slashes or dots)", () => {
  const d = conversationDiscriminator("Guest", "hi / there . now");
  assert(
    /^[0-9a-z]+$/.test(d),
    `discriminator must be base36-safe, got "${d}"`,
  );
});
