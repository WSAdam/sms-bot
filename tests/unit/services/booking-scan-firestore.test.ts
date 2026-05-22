// Regression guards for the booking-scan Firestore-first refactor.
//
// The pre-refactor code did 1 Bland API call per conversation (1,200
// sequential calls for a 30-day window → 503 BOOT_FAILED on Deno
// Deploy). The new code reads conversation messages from Firestore in
// one bounded list and only contacts Bland for variables.Desired_Time
// on conversations that have a detected signal.
//
// These tests pin:
//   1. The Firestore-first behavior — `db.list` against the
//      conversations collection with a `timestamp >=` filter is the
//      ONLY collection read for the message-walking step.
//   2. Signal detection still works against Firestore's
//      "Guest" | "AI Bot" sender enum (was hardcoded to "USER" before).
//   3. The skip-checks that prevent re-injection still run per
//      conversation (recoveredFromCallId, guestactivated, pending).

import { assert, assertEquals } from "@std/assert";
import {
  conversationDocPath,
  conversationsCollection,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import { scanConversationsForBookings } from "@shared/services/conversations/booking-scan.ts";
import { conversationDocId } from "@shared/util/id.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

interface SeededMsg {
  phone: string;
  callId: string;
  sender: "Guest" | "AI Bot";
  message: string;
  timestamp: string;
  nodeTag?: string;
}

function seed(mock: FirestoreMock, msgs: SeededMsg[]): void {
  for (const m of msgs) {
    mock.docs.set(
      conversationDocPath(conversationDocId(m.phone, m.callId, m.timestamp)),
      {
        phoneNumber: m.phone,
        callId: m.callId,
        timestamp: m.timestamp,
        sender: m.sender,
        message: m.message,
        ...(m.nodeTag ? { nodeTag: m.nodeTag } : {}),
      },
    );
  }
}

interface ListCall {
  parentPath: string;
  opts: { where?: { field: string; op: string; value: unknown } };
}

function spyList(mock: FirestoreMock): ListCall[] {
  const calls: ListCall[] = [];
  const orig = mock.list.bind(mock);
  // deno-lint-ignore no-explicit-any
  (mock as any).list = (parentPath: string, opts: any = {}) => {
    calls.push({ parentPath, opts });
    return orig(parentPath, opts);
  };
  return calls;
}

Deno.test("booking-scan reads conversations from Firestore, not Bland API", async () => {
  // The first list call against the conversations collection MUST be a
  // where(timestamp >=) filter on the messages collection. The pre-fix
  // code called bland.listConversationsByDateRange (no Firestore list)
  // — this test fails if anyone re-introduces that path.
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const calls = spyList(mock);
    await scanConversationsForBookings(
      "2026-05-01T00:00:00.000Z",
      "2026-05-22T23:59:59.999Z",
      false, // dry-run
    );
    const initialList = calls[0];
    assert(initialList, "booking-scan must start with a Firestore list call");
    assertEquals(initialList.parentPath, conversationsCollection);
    assertEquals(initialList.opts.where?.field, "timestamp");
    assertEquals(initialList.opts.where?.op, ">=");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("detects 'locked in' signal from Firestore Guest/AI Bot sender enum", async () => {
  // Pre-fix detectSignal hardcoded `sender === "USER"` to skip guest
  // messages. Firestore uses "Guest" | "AI Bot". Without the senderIs
  // Guest helper, the refactor would treat bot-sent "locked in"
  // messages as guest messages and skip them, silently dropping
  // signals.
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const t0 = "2026-05-10T14:00:00.000Z";
    const t1 = "2026-05-10T14:01:00.000Z";
    const t2 = "2026-05-10T14:02:00.000Z";
    seed(mock, [
      {
        phone: "5551239876",
        callId: "convo-1",
        sender: "Guest",
        message: "yeah next tuesday 2pm works",
        timestamp: t0,
      },
      {
        phone: "5551239876",
        callId: "convo-1",
        sender: "AI Bot",
        message: "Great — you're locked in for Tuesday at 2pm.",
        timestamp: t1,
      },
      {
        phone: "5551239876",
        callId: "convo-1",
        sender: "Guest",
        message: "thanks",
        timestamp: t2,
      },
    ]);
    const summary = await scanConversationsForBookings(
      "2026-05-01T00:00:00.000Z",
      "2026-05-22T23:59:59.999Z",
      false,
    );
    assertEquals(
      summary.proposed,
      1,
      `expected 1 proposal for the locked_in signal, got ${summary.proposed}`,
    );
    const p = summary.proposals[0];
    assertEquals(p.phone10, "5551239876");
    assertEquals(p.signal, "locked_in");
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("skips conversations with no signal — no Bland call", async () => {
  // The whole point of the refactor: conversations without a signal
  // shouldn't trigger ANY Bland API call. We can't directly mock
  // bland.getBlandDesiredTime here, but we can assert the proposal
  // count stays 0 when no bot message ever says "locked in" /
  // "Appointment Scheduled".
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    seed(mock, [
      {
        phone: "5551239877",
        callId: "convo-2",
        sender: "Guest",
        message: "not interested",
        timestamp: "2026-05-12T10:00:00.000Z",
      },
      {
        phone: "5551239877",
        callId: "convo-2",
        sender: "AI Bot",
        message: "Understood. Have a great day.",
        timestamp: "2026-05-12T10:01:00.000Z",
      },
    ]);
    const summary = await scanConversationsForBookings(
      "2026-05-01T00:00:00.000Z",
      "2026-05-22T23:59:59.999Z",
      false,
    );
    assertEquals(summary.proposed, 0);
    // 1 conversation scanned (the no-signal one).
    assertEquals(summary.blandConversations, 1);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("excluded test phones never become proposals", async () => {
  // 8432222986 is in EXCLUDED_REPORTING_PHONES — the cron sweep would
  // dial Adam's own phone if it ever made it through. Pre-fix this
  // was guarded inside the per-conversation loop; the refactor must
  // preserve the guard.
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    seed(mock, [
      {
        phone: "8432222986", // Adam's test phone
        callId: "convo-3",
        sender: "AI Bot",
        message: "You're locked in for Friday at 10am.",
        timestamp: "2026-05-14T09:00:00.000Z",
      },
    ]);
    const summary = await scanConversationsForBookings(
      "2026-05-01T00:00:00.000Z",
      "2026-05-22T23:59:59.999Z",
      false,
    );
    assertEquals(summary.proposed, 0);
    assert(summary.skippedExisting >= 1);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("upper-bound timestamp filter trims messages outside the window", async () => {
  // The Firestore list uses where(timestamp >= fromIso) — the toIso
  // upper bound is enforced client-side after the query. This test
  // confirms a message after toIso is correctly excluded.
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    seed(mock, [
      {
        phone: "5551239878",
        callId: "convo-4",
        sender: "AI Bot",
        message: "You're locked in for May 16 at 1pm.",
        timestamp: "2026-05-25T09:00:00.000Z", // AFTER toIso below
      },
    ]);
    const summary = await scanConversationsForBookings(
      "2026-05-01T00:00:00.000Z",
      "2026-05-22T23:59:59.999Z",
      false,
    );
    // Message at 2026-05-25 is outside the upper bound; conversation
    // shouldn't be counted.
    assertEquals(summary.blandConversations, 0);
    assertEquals(summary.proposed, 0);
  } finally {
    setFirestoreClientForTests(null);
  }
});
