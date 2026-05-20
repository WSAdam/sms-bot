import { assertEquals } from "@std/assert";
import {
  getAllConversations,
  storeMessage,
} from "@shared/services/conversations/store.ts";
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

Deno.test("getAllConversations returns only the requested phone's messages", async () => {
  const mock = new FirestoreMock();

  await storeMessage("8432222986", "call-1", "Guest", "mine-1", undefined, undefined, mock);
  await tick();
  await storeMessage("8432222986", "call-2", "AI Bot", "mine-2", undefined, undefined, mock);
  await tick();
  await storeMessage("9999999999", "call-3", "Guest", "other-phone", undefined, undefined, mock);

  const got = await getAllConversations("8432222986", mock);

  assertEquals(got.length, 2);
  assertEquals(got.map((m) => m.message).sort(), ["mine-1", "mine-2"]);
});

Deno.test("getAllConversations does NOT do a full-collection scan", async () => {
  // Regression guard for the 2026-05-19 incident: the prior implementation
  // listed the entire conversations collection per call. Assert the wrapper
  // is invoked with a phoneNumber equality filter so the database does the
  // narrowing, not in-memory JS.
  const mock = new FirestoreMock();
  let lastWhereField: string | undefined;
  const origList = mock.list.bind(mock);
  // deno-lint-ignore no-explicit-any
  (mock as any).list = (parentPath: string, opts: any = {}) => {
    lastWhereField = opts.where?.field;
    return origList(parentPath, opts);
  };

  await storeMessage("8432222986", "call-1", "Guest", "hi", undefined, undefined, mock);
  await tick();
  await getAllConversations("8432222986", mock);

  assertEquals(lastWhereField, "phoneNumber");
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
