import { assert, assertEquals, assertNotEquals } from "#assert";
import {
  conversationDocId,
  injectionDiscriminator,
  injectionHistoryDocId,
  orchestratorEventDocId,
  sha256Hex,
} from "./mod.ts";

Deno.test("doc-id builders compose parts with __", () => {
  assertEquals(
    conversationDocId("5551230001", "c1", "t1"),
    "5551230001__c1__t1",
  );
  assertEquals(injectionHistoryDocId("5551230001", "t1"), "5551230001__t1");
  assertEquals(orchestratorEventDocId("5551230001", "t1"), "5551230001__t1");
});

Deno.test("injectionHistoryDocId: optional discriminator appends a 3rd segment", () => {
  // Same phone + same firedAt millisecond, two DIFFERENT injects: without a
  // discriminator the ids collide and set(merge:false) overwrites one's audit
  // trail. The discriminator disambiguates them (mirrors conversationDocId).
  assertEquals(
    injectionHistoryDocId("5551230001", "t1", "ab12cd34"),
    "5551230001__t1__ab12cd34",
  );
  assertNotEquals(
    injectionHistoryDocId("5551230001", "t1", "ab12cd34"),
    injectionHistoryDocId("5551230001", "t1", "ef56gh78"),
  );
  // Omitted discriminator stays backward-compatible with the 2-part id used by
  // the sweep/fireSingle/legacy-key-map paths.
  assertEquals(injectionHistoryDocId("5551230001", "t1"), "5551230001__t1");
});

Deno.test("injectionDiscriminator: short, Firestore-safe, and distinct across many calls", () => {
  // Volume check — two non-colliding samples prove nothing about collision rate.
  // 1000 nonces in a tight loop guards the property the discriminator exists for:
  // same-millisecond talk-now injects for one phone must get distinct doc-id
  // segments (also stresses any same-tick path if it's time/counter-seeded).
  const seen = new Set<string>();
  for (let i = 0; i < 1000; i++) seen.add(injectionDiscriminator());
  assertEquals(seen.size, 1000, "1000 nonces must all be distinct");
  // Short + no "/" so it's a safe Firestore doc-id segment.
  const sample = injectionDiscriminator();
  assert(sample.length > 0 && sample.length <= 12);
  assert(!sample.includes("/"));
});

Deno.test("sha256Hex is deterministic and hex", async () => {
  const a = await sha256Hex("hello");
  const b = await sha256Hex("hello");
  assertEquals(a, b);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
});
