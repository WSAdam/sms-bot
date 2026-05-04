import { assertEquals } from "@std/assert";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

function msg(over: Partial<ConversationMessage>): ConversationMessage {
  return {
    phoneNumber: "8432222986",
    callId: "call-1",
    timestamp: "2026-05-01T15:00:00.000Z",
    sender: "Guest",
    message: "sure",
    ...over,
  };
}

Deno.test("dedupeMessages collapses identical (callId, sender, message)", () => {
  const out = dedupeMessages([
    msg({ timestamp: "2026-05-01T15:00:00.000Z", nodeTag: "Greeting" }),
    msg({ timestamp: "2026-05-01T15:01:00.000Z", nodeTag: "Option" }),
    msg({ timestamp: "2026-05-01T15:02:00.000Z", nodeTag: "Option" }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].nodeTag, "Greeting", "earliest doc should win");
});

Deno.test("dedupeMessages keeps distinct senders", () => {
  const out = dedupeMessages([
    msg({ sender: "Guest", message: "yes" }),
    msg({
      sender: "AI Bot",
      message: "yes",
      timestamp: "2026-05-01T15:00:01.000Z",
    }),
  ]);
  assertEquals(out.length, 2);
});

Deno.test("dedupeMessages keeps distinct messages", () => {
  const out = dedupeMessages([
    msg({ message: "yes" }),
    msg({ message: "no", timestamp: "2026-05-01T15:00:01.000Z" }),
  ]);
  assertEquals(out.length, 2);
});

Deno.test("dedupeMessages keeps distinct callIds", () => {
  const out = dedupeMessages([
    msg({ callId: "call-1" }),
    msg({ callId: "call-2", timestamp: "2026-05-01T15:00:01.000Z" }),
  ]);
  assertEquals(out.length, 2);
});

Deno.test("dedupeMessages keeps malformed records (passes through)", () => {
  const out = dedupeMessages([
    // deno-lint-ignore no-explicit-any
    { phoneNumber: "x", timestamp: "t" } as any,
    // deno-lint-ignore no-explicit-any
    { phoneNumber: "y", timestamp: "t" } as any,
    msg({}),
  ]);
  assertEquals(out.length, 3, "malformed pass through individually");
});

Deno.test("dedupeMessages picks earliest by ISO-string compare across many", () => {
  const out = dedupeMessages([
    msg({ timestamp: "2026-05-01T15:05:00.000Z", nodeTag: "C" }),
    msg({ timestamp: "2026-05-01T15:00:00.000Z", nodeTag: "A" }),
    msg({ timestamp: "2026-05-01T15:03:00.000Z", nodeTag: "B" }),
  ]);
  assertEquals(out.length, 1);
  assertEquals(out[0].nodeTag, "A");
});
