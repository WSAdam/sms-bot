// Guards two reseedOne fixes, exercised through reseedConversationsForPhone
// (which drives reseedOne):
//
//  1. Filtered-vs-unfiltered skip: reseedOne filters '<Call Connected>' out of
//     the Bland messages but compared against the UNFILTERED Firestore count.
//     The webhook path stores '<Call Connected>' unfiltered, so the inflated
//     Firestore count made reseedOne skip valid reseeds. The fix filters the
//     Firestore side the same way before comparing.
//
//  2. GUEST sender mapping: reseedOne mapped sender with a case-sensitive
//     `=== "USER"` check, so a 'GUEST' sender fell through to 'AI Bot',
//     diverging from ingestBlandTranscript (USER|GUEST → Guest). The fix
//     matches the ingest mapping.

import { assert, assertEquals } from "@std/assert";
import { reseedConversationsForPhone } from "@messaging/domain/business/reseed/mod.ts";
import {
  conversationDocPath,
  conversationsCollection,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

const PHONE = "9366762277";
const CALL_ID = "conv-abc";

// bland.authHeader → loadEnv() validates the full app env (Firestore creds +
// project id + Bland key) even though we only hit Bland over a stubbed fetch
// and the Firestore client is overridden. Provide harmless dummies so loadEnv
// doesn't throw. The values are never used for a real connection here.
function setBlandEnv() {
  Deno.env.set("BLAND_API_KEY", "test-key");
  Deno.env.set("FIREBASE_PROJECT_ID", "test-project");
  Deno.env.set(
    "FIREBASE_SERVICE_ACCOUNT_JSON",
    JSON.stringify({ client_email: "x@y.z", private_key: "k" }),
  );
}

// Stub fetch for both Bland endpoints: the phone-search LIST call and the
// per-conversation getConversation call (URL ends with /<callId>).
function stubBland(
  blandMessages: Array<{ sender: string; message: string; created_at: string }>,
): typeof globalThis.fetch {
  return (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith(`/${CALL_ID}`)) {
      return Promise.resolve(
        new Response(
          JSON.stringify({ data: { messages: blandMessages } }),
          { status: 200 },
        ),
      );
    }
    // Otherwise it's the list/search call.
    return Promise.resolve(
      new Response(
        JSON.stringify({
          data: [{
            id: CALL_ID,
            user_number: `1${PHONE}`,
            created_at: "2026-06-24T00:00:00.000Z",
          }],
        }),
        { status: 200 },
      ),
    );
  };
}

function seedFirestoreMessage(
  db: FirestoreMock,
  docId: string,
  message: string,
  sender: string,
  ts: string,
) {
  db.docs.set(conversationDocPath(docId), {
    phoneNumber: PHONE,
    callId: CALL_ID,
    sender,
    message,
    timestamp: ts,
  });
}

function storedMessages(db: FirestoreMock) {
  const out: Array<Record<string, unknown>> = [];
  for (const [path, data] of db.docs.entries()) {
    if (path.startsWith(`${conversationsCollection}/`)) out.push(data);
  }
  return out;
}

Deno.test(
  "reseedOne: maps a Bland 'GUEST' sender to 'Guest' (not 'AI Bot')",
  async () => {
    setBlandEnv();
    const db = new FirestoreMock();
    setFirestoreClientForTests(db);
    const original = globalThis.fetch;
    globalThis.fetch = stubBland([
      {
        sender: "GUEST",
        message: "hi from the guest",
        created_at: "2026-06-24T15:30:00.000Z",
      },
      {
        sender: "AGENT",
        message: "hi from the bot",
        created_at: "2026-06-24T15:30:01.000Z",
      },
    ]);
    try {
      // Firestore empty for this call → 2 real Bland > 0 stored → reseeds.
      await reseedConversationsForPhone(PHONE);
      const msgs = storedMessages(db);
      const guestMsg = msgs.find((m) => m.message === "hi from the guest");
      assert(guestMsg, "the GUEST message was stored");
      assertEquals(guestMsg!.sender, "Guest");
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
    }
  },
);

Deno.test(
  "reseedOne: does NOT skip when Firestore's count is inflated by '<Call Connected>' filler",
  async () => {
    setBlandEnv();
    const db = new FirestoreMock();
    setFirestoreClientForTests(db);
    // Firestore holds 2 REAL + 2 '<Call Connected>' filler = count 4 unfiltered.
    seedFirestoreMessage(
      db,
      `${PHONE}__${CALL_ID}__t0`,
      "real-1",
      "AI Bot",
      "2026-06-24T15:00:00.000Z",
    );
    seedFirestoreMessage(
      db,
      `${PHONE}__${CALL_ID}__t1`,
      "real-2",
      "Guest",
      "2026-06-24T15:00:01.000Z",
    );
    seedFirestoreMessage(
      db,
      `${PHONE}__${CALL_ID}__t2`,
      "<Call Connected>",
      "AI Bot",
      "2026-06-24T15:00:02.000Z",
    );
    seedFirestoreMessage(
      db,
      `${PHONE}__${CALL_ID}__t3`,
      "<Call Connected>",
      "AI Bot",
      "2026-06-24T15:00:03.000Z",
    );

    const original = globalThis.fetch;
    // Bland returns 3 REAL messages (filtered) — more than the 2 real stored,
    // but FEWER than the inflated unfiltered Firestore count of 4. Pre-fix
    // (3 <= 4) skipped; post-fix (3 > 2 real) reseeds.
    globalThis.fetch = stubBland([
      {
        sender: "AGENT",
        message: "real-1",
        created_at: "2026-06-24T15:00:00.000Z",
      },
      {
        sender: "USER",
        message: "real-2",
        created_at: "2026-06-24T15:00:01.000Z",
      },
      {
        sender: "AGENT",
        message: "real-3-NEW",
        created_at: "2026-06-24T15:00:04.000Z",
      },
    ]);
    try {
      const summary = await reseedConversationsForPhone(PHONE);
      assertEquals(summary.reseeded, 1, "must reseed, not skip");
      assertEquals(summary.skippedFewer, 0);
      // The new real message is now stored; the filler docs were replaced.
      const msgs = storedMessages(db);
      assert(
        msgs.some((m) => m.message === "real-3-NEW"),
        "the new real message was synced",
      );
      assert(
        !msgs.some((m) => m.message === "<Call Connected>"),
        "filler docs were replaced by the reseed delete+set",
      );
    } finally {
      globalThis.fetch = original;
      setFirestoreClientForTests(null);
    }
  },
);
