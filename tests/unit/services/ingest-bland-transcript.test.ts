// Adversarial coverage for ingestBlandTranscript — the on-booking, purely
// additive Bland→conversations pull wired into the public /cal/schedule and
// /sms-callback/bland/talk-now webhooks. Because those endpoints are public and
// the helper writes to Firestore, the test surface is deliberately hostile:
// malformed/huge/malicious Bland payloads, caller-supplied conversationId
// injection, idempotency, additivity, and "best-effort never throws."
import { assert, assertEquals } from "@std/assert";
import { ingestBlandTranscript } from "@messaging/domain/business/reseed/mod.ts";
import { dedupeMessages } from "@messaging/domain/business/conv-dedupe/mod.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";
import type { ConversationMessage } from "@core/dto/conversation.ts";

const PHONE = "9366762277";

// deno-lint-ignore no-explicit-any
function convo(messages: any[], over: Record<string, unknown> = {}) {
  return { status: 200, ok: true, json: { data: { messages } }, ...over };
}
function msg(sender: string, message: unknown, created_at: unknown) {
  return { sender, message, created_at };
}

// Fake Bland deps with call recording. getConversation resolves from a map of
// id → response; searchConversationsByPhone returns a fixed list.
function deps(opts: {
  // deno-lint-ignore no-explicit-any
  conversations?: Record<string, any>;
  // deno-lint-ignore no-explicit-any
  searchResult?: any[];
  getThrows?: boolean;
  searchThrows?: boolean;
}) {
  const getCalls: string[] = [];
  const searchCalls: string[] = [];
  const client = new FirestoreMock();
  return {
    getCalls,
    searchCalls,
    client,
    deps: {
      // deno-lint-ignore no-explicit-any
      getConversation: ((id: string): Promise<any> => {
        getCalls.push(id);
        if (opts.getThrows) throw new Error("bland down");
        return Promise.resolve(
          opts.conversations?.[id] ??
            { status: 404, ok: false, json: { errors: ["not found"] } },
        );
        // deno-lint-ignore no-explicit-any
      }) as any,
      // deno-lint-ignore no-explicit-any
      searchConversationsByPhone: ((phone: string): Promise<any[]> => {
        searchCalls.push(phone);
        if (opts.searchThrows) throw new Error("search down");
        return Promise.resolve(opts.searchResult ?? []);
        // deno-lint-ignore no-explicit-any
      }) as any,
      client,
    },
  };
}

function storedDocs(client: FirestoreMock) {
  return [...client.docs.entries()].filter(([p]) =>
    p.startsWith(conversationsCollection + "/")
  );
}

Deno.test("happy path: stores each message by conversationId with correct mapping", async () => {
  const t = deps({
    conversations: {
      conv1: convo([
        msg("USER", "I want to talk now", "2026-06-22T10:00:00.000Z"),
        msg("ASSISTANT", "Locked in!", "2026-06-22T10:01:00.000Z"),
      ]),
    },
  });
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 2);
  assertEquals(s.conversations, 1);
  assertEquals(s.errored, 0);
  assertEquals(t.getCalls, ["conv1"]); // direct fetch, no phone search
  assertEquals(t.searchCalls, []);
  const docs = storedDocs(t.client);
  assertEquals(docs.length, 2);
  const guest = t.client.docs.get(
    `${conversationsCollection}/${PHONE}__conv1__2026-06-22T10:00:00.000Z`,
  );
  assertEquals(guest?.sender, "Guest");
  assertEquals(guest?.message, "I want to talk now");
  assertEquals(guest?.phoneNumber, PHONE);
  assertEquals(guest?.callId, "conv1");
  const bot = t.client.docs.get(
    `${conversationsCollection}/${PHONE}__conv1__2026-06-22T10:01:00.000Z`,
  );
  assertEquals(bot?.sender, "AI Bot");
});

Deno.test("phone fallback when no conversationId; fuzzy-mismatch filtered out", async () => {
  const t = deps({
    searchResult: [
      { id: "convA", user_number: `+1${PHONE}`, message_count: 1 },
      { id: "convB", user_number: "+15550001111", message_count: 1 }, // not us
    ],
    conversations: {
      convA: convo([msg("USER", "hi", "2026-06-22T10:00:00.000Z")]),
      convB: convo([msg("USER", "other", "2026-06-22T10:00:00.000Z")]),
    },
  });
  const s = await ingestBlandTranscript(PHONE, undefined, t.deps);
  assertEquals(t.searchCalls, [PHONE]);
  assertEquals(t.getCalls, ["convA"]); // convB excluded by fuzzy guard
  assertEquals(s.conversations, 1);
  assertEquals(s.stored, 1);
});

Deno.test("idempotent: re-running stores the same doc ids, no duplicates", async () => {
  const t = deps({
    conversations: {
      conv1: convo([msg("USER", "hi", "2026-06-22T10:00:00.000Z")]),
    },
  });
  await ingestBlandTranscript(PHONE, "conv1", t.deps);
  const after1 = storedDocs(t.client).length;
  await ingestBlandTranscript(PHONE, "conv1", t.deps);
  const after2 = storedDocs(t.client).length;
  assertEquals(after1, 1);
  assertEquals(after2, 1); // overwrite, not duplicate
});

Deno.test("additive: never deletes pre-existing docs (e.g. the appointment-scheduled marker)", async () => {
  const t = deps({
    conversations: {
      conv1: convo([msg("USER", "hi", "2026-06-22T10:00:00.000Z")]),
    },
  });
  const markerPath = `${conversationsCollection}/${PHONE}__conv1__marker`;
  await t.client.set(markerPath, {
    phoneNumber: PHONE,
    callId: "conv1",
    sender: "AI Bot",
    message: "Appointment Scheduled: Jun 22",
    nodeTag: "appointment scheduled",
    timestamp: "2026-06-19T12:00:00.000Z",
  });
  await ingestBlandTranscript(PHONE, "conv1", t.deps);
  const marker = t.client.docs.get(markerPath);
  assert(marker, "marker must survive");
  assertEquals(marker?.nodeTag, "appointment scheduled");
  assertEquals(storedDocs(t.client).length, 2); // marker + the pulled message
});

Deno.test("SSRF guard: unsafe conversationId is never passed to getConversation; falls back to phone search", async () => {
  for (const bad of ["../sms/send", "abc/def", "x?key=1", "a b", "id#frag"]) {
    const t = deps({ searchResult: [] });
    await ingestBlandTranscript(PHONE, bad, t.deps);
    assertEquals(t.getCalls.includes(bad), false, `must not fetch "${bad}"`);
    assertEquals(
      t.searchCalls,
      [PHONE],
      `must fall back to search for "${bad}"`,
    );
  }
});

Deno.test("invalid phone: early return, no Bland calls", async () => {
  for (const bad of ["abc", "12345", "", "+19366762277"]) {
    const t = deps({});
    const s = await ingestBlandTranscript(bad, "conv1", t.deps);
    assertEquals(t.getCalls, []);
    assertEquals(t.searchCalls, []);
    assertEquals(s.errored, 1);
    assertEquals(s.stored, 0);
  }
});

Deno.test("malformed Bland responses are handled, never thrown", async () => {
  // !ok, missing data, non-array messages, null json
  const t = deps({
    conversations: {
      a: { status: 500, ok: false, json: { errors: ["boom"] } },
      b: { status: 200, ok: true, json: {} }, // no data
      c: { status: 200, ok: true, json: { data: { messages: "nope" } } },
      // deno-lint-ignore no-explicit-any
      d: { status: 200, ok: true, json: null as any },
    },
  });
  for (const id of ["a", "b", "c", "d"]) {
    const s = await ingestBlandTranscript(PHONE, id, t.deps);
    assertEquals(s.stored, 0, `id ${id} stores nothing`);
    assert(s.errored >= 0); // never throws
  }
});

Deno.test("skips placeholders, empty/non-string messages, and non-ISO timestamps", async () => {
  const t = deps({
    conversations: {
      conv1: convo([
        msg("USER", "<Call Connected>", "2026-06-22T10:00:00.000Z"),
        msg("USER", "", "2026-06-22T10:00:01.000Z"),
        msg("USER", null, "2026-06-22T10:00:02.000Z"),
        msg("USER", "no ts", undefined),
        msg("USER", "slash ts", "2026/06/22"), // "/" → illegal doc id
        msg("USER", "dot ts", "."), // "." → illegal Firestore id
        msg("USER", "dotdot ts", ".."), // ".." → illegal Firestore id
        msg("USER", "not a date", "yesterday"),
        msg("USER", "epoch num", 1750000000000), // not a string
        msg("USER", "good", "2026-06-22T10:00:09.000Z"),
        msg("USER", "good-offset", "2026-06-22T10:00:10-04:00"),
      ]),
    },
  });
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 2); // only the two valid ISO timestamps
  assertEquals(s.skipped, 9);
  assert(
    t.client.docs.has(
      `${conversationsCollection}/${PHONE}__conv1__2026-06-22T10:00:09.000Z`,
    ),
  );
});

Deno.test("sender mapping matches the per-call webhook (USER|GUEST → Guest)", async () => {
  const t = deps({
    conversations: {
      conv1: convo([
        msg("USER", "a", "2026-06-22T10:00:00.000Z"),
        msg("user", "b", "2026-06-22T10:00:01.000Z"), // lowercase
        msg("GUEST", "c", "2026-06-22T10:00:02.000Z"),
        msg("ASSISTANT", "d", "2026-06-22T10:00:03.000Z"),
        msg("AGENT", "e", "2026-06-22T10:00:04.000Z"),
        msg(undefined as unknown as string, "f", "2026-06-22T10:00:05.000Z"),
      ]),
    },
  });
  await ingestBlandTranscript(PHONE, "conv1", t.deps);
  const senderOf = (ts: string) =>
    t.client.docs.get(`${conversationsCollection}/${PHONE}__conv1__${ts}`)
      ?.sender;
  assertEquals(senderOf("2026-06-22T10:00:00.000Z"), "Guest"); // USER
  assertEquals(senderOf("2026-06-22T10:00:01.000Z"), "Guest"); // user
  assertEquals(senderOf("2026-06-22T10:00:02.000Z"), "Guest"); // GUEST
  assertEquals(senderOf("2026-06-22T10:00:03.000Z"), "AI Bot"); // ASSISTANT
  assertEquals(senderOf("2026-06-22T10:00:04.000Z"), "AI Bot"); // AGENT
  assertEquals(senderOf("2026-06-22T10:00:05.000Z"), "AI Bot"); // missing
});

Deno.test("skips oversized message bodies (abuse bound)", async () => {
  const t = deps({
    conversations: {
      conv1: convo([
        msg("USER", "x".repeat(8001), "2026-06-22T10:00:00.000Z"),
        msg("USER", "x".repeat(8000), "2026-06-22T10:00:01.000Z"),
      ]),
    },
  });
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 1); // the 8000-char one is kept; 8001 dropped
  assertEquals(s.skipped, 1);
});

Deno.test("per-conversation message cap truncates the tail and accounts it as skipped", async () => {
  const messages = Array.from({ length: 600 }, (_, i) =>
    msg(
      "USER",
      `m${i}`,
      `2026-06-22T${String(10 + Math.floor(i / 60)).padStart(2, "0")}:${
        String(i % 60).padStart(2, "0")
      }:00.000Z`,
    ));
  const t = deps({ conversations: { conv1: convo(messages) } });
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 500); // MAX_MESSAGES_PER_CONVERSATION
  assertEquals(s.skipped, 100); // 600 - 500 truncated, accounted
});

Deno.test("best-effort: getConversation throwing is caught, summary records it, no throw", async () => {
  const t = deps({ getThrows: true });
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 0);
  assertEquals(s.errored, 1);
  assert(s.errors.length >= 1);
});

Deno.test("best-effort: searchConversationsByPhone throwing is caught, no throw", async () => {
  const t = deps({ searchThrows: true });
  const s = await ingestBlandTranscript(PHONE, undefined, t.deps);
  assertEquals(s.stored, 0);
  assertEquals(s.errored, 1);
});

Deno.test("conversation cap: more than the limit (12) are bounded", async () => {
  const searchResult = Array.from({ length: 40 }, (_, i) => ({
    id: `c${i}`,
    user_number: `+1${PHONE}`,
    message_count: 1,
  }));
  // deno-lint-ignore no-explicit-any
  const conversations: Record<string, any> = {};
  for (let i = 0; i < 40; i++) {
    conversations[`c${i}`] = convo([
      msg(
        "USER",
        `m${i}`,
        `2026-06-22T10:00:${String(i).padStart(2, "0")}.000Z`,
      ),
    ]);
  }
  const t = deps({ searchResult, conversations });
  const s = await ingestBlandTranscript(PHONE, undefined, t.deps);
  assertEquals(s.conversations, 12);
  assertEquals(t.getCalls.length, 12); // capped — only 12 fetched
  assert(s.errors.some((e) => e.includes("capped")));
});

Deno.test("batch chunking: a 500-message transcript writes in <=400-op batches", async () => {
  // Valid distinct ISO timestamps (minute = i/60 ≤ 8, second = i%60).
  const msgs = Array.from({ length: 500 }, (_, i) =>
    msg(
      i % 2 ? "USER" : "ASSISTANT",
      `m${i}`,
      `2026-06-22T10:${String(Math.floor(i / 60)).padStart(2, "0")}:${
        String(i % 60).padStart(2, "0")
      }.000Z`,
    ));
  const t = deps({ conversations: { conv1: convo(msgs) } });
  let batchCalls = 0;
  let maxOps = 0;
  const orig = t.client.batch.bind(t.client);
  t.client.batch = (ops) => {
    batchCalls++;
    maxOps = Math.max(maxOps, ops.length);
    return orig(ops);
  };
  const s = await ingestBlandTranscript(PHONE, "conv1", t.deps);
  assertEquals(s.stored, 500);
  assertEquals(
    batchCalls,
    2,
    `500 ops → 400 + 100 = 2 batches, got ${batchCalls}`,
  );
  assert(maxOps <= 400, `no batch exceeds 400 ops, saw ${maxOps}`);
});

Deno.test("message content is stored verbatim (escaping is a render concern, not storage)", async () => {
  const evil = '<script>alert(1)</script> & "quotes"';
  const t = deps({
    conversations: {
      conv1: convo([msg("USER", evil, "2026-06-22T10:00:00.000Z")]),
    },
  });
  await ingestBlandTranscript(PHONE, "conv1", t.deps);
  const doc = t.client.docs.get(
    `${conversationsCollection}/${PHONE}__conv1__2026-06-22T10:00:00.000Z`,
  );
  assertEquals(doc?.message, evil);
});

Deno.test("dedupe premise: ingest copy and a webhook copy of the same line collapse to one", async () => {
  // The webhook stores with sender USER→"Guest" and a Date.now() timestamp;
  // ingest stores the same line with sender USER→"Guest" and the Bland
  // created_at timestamp. Different doc ids (different timestamps), SAME dedupe
  // key (callId__sender__message) — so dedupeMessages must collapse them, and
  // keep the earliest (the Bland created_at). This is what makes the additive
  // ingest safe in the search views (which now dedupe at read).
  const webhookCopy: ConversationMessage = {
    phoneNumber: PHONE,
    callId: "conv1",
    sender: "Guest",
    message: "I want to talk now",
    timestamp: "2026-06-22T10:05:00.000Z", // later (webhook server time)
  };
  const ingestCopy: ConversationMessage = {
    phoneNumber: PHONE,
    callId: "conv1",
    sender: "Guest",
    message: "I want to talk now",
    timestamp: "2026-06-22T10:00:00.000Z", // earlier (Bland created_at)
  };
  const collapsed = dedupeMessages([webhookCopy, ingestCopy]);
  assertEquals(collapsed.length, 1);
  assertEquals(collapsed[0].timestamp, "2026-06-22T10:00:00.000Z"); // earliest wins
});
