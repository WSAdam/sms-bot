import { assertEquals } from "@std/assert";
import { storeMessage } from "@shared/services/conversations/store.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { FirestoreMock } from "../../mocks/firestore-mock.ts";

function countMessages(mock: FirestoreMock): number {
  let n = 0;
  for (const path of mock.docs.keys()) {
    if (path.startsWith(`${conversationsCollection}/`)) n++;
  }
  return n;
}

// Spacing out writes so the millisecond-resolution doc ID doesn't collide
// in tight test loops. Production webhooks are spaced 50ms+ apart in practice.
const tick = () => new Promise((r) => setTimeout(r, 5));

Deno.test("storeMessage dedupes identical (callId, sender, message) writes", async () => {
  const mock = new FirestoreMock();

  await storeMessage("8432222986", "call-1", "Guest", "sure", "Greeting", undefined, mock);
  await tick();
  await storeMessage("8432222986", "call-1", "Guest", "sure", "Option", undefined, mock);

  assertEquals(countMessages(mock), 1);
});

Deno.test("storeMessage does not dedupe across different senders", async () => {
  const mock = new FirestoreMock();

  await storeMessage("8432222986", "call-1", "Guest", "sure", undefined, undefined, mock);
  await tick();
  await storeMessage("8432222986", "call-1", "AI Bot", "sure", undefined, undefined, mock);

  assertEquals(countMessages(mock), 2);
});

Deno.test("storeMessage does not dedupe across different messages", async () => {
  const mock = new FirestoreMock();

  await storeMessage("8432222986", "call-1", "Guest", "sure", undefined, undefined, mock);
  await tick();
  await storeMessage("8432222986", "call-1", "Guest", "yeah", undefined, undefined, mock);

  assertEquals(countMessages(mock), 2);
});

Deno.test("storeMessage does not dedupe across different callIds", async () => {
  const mock = new FirestoreMock();

  await storeMessage("8432222986", "call-1", "Guest", "sure", undefined, undefined, mock);
  await tick();
  await storeMessage("8432222986", "call-2", "Guest", "sure", undefined, undefined, mock);

  assertEquals(countMessages(mock), 2);
});

Deno.test("storeMessage dedupe returns the original message (with original nodeTag)", async () => {
  const mock = new FirestoreMock();

  const first = await storeMessage(
    "8432222986", "call-1", "Guest", "sure", "Greeting", undefined, mock,
  );
  await tick();
  const second = await storeMessage(
    "8432222986", "call-1", "Guest", "sure", "Option", undefined, mock,
  );

  assertEquals(second.timestamp, first.timestamp);
  assertEquals(second.nodeTag, "Greeting");
});
