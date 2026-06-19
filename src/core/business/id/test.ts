import { assertEquals } from "#assert";
import {
  conversationDocId,
  injectionHistoryDocId,
  orchestratorEventDocId,
  sha256Hex,
} from "./mod.ts";

Deno.test("doc-id builders compose parts with __", () => {
  assertEquals(conversationDocId("5551230001", "c1", "t1"), "5551230001__c1__t1");
  assertEquals(injectionHistoryDocId("5551230001", "t1"), "5551230001__t1");
  assertEquals(orchestratorEventDocId("5551230001", "t1"), "5551230001__t1");
});

Deno.test("sha256Hex is deterministic and hex", async () => {
  const a = await sha256Hex("hello");
  const b = await sha256Hex("hello");
  assertEquals(a, b);
  assertEquals(/^[0-9a-f]{64}$/.test(a), true);
});
