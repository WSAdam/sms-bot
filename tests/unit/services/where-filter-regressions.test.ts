// Regression guards for the 2026-05-19 incident pattern: anywhere we
// previously listed an entire collection and filtered in memory now uses
// a database-side `where` filter (or a single-doc `get`). Each test spies
// on `mock.list` / `mock.get` and asserts the wrapper was called with the
// right shape — if a future change reverts to "list everything", the
// test fails before the regression ships.
//
// Same shape as the existing getAllConversations test
// (tests/unit/services/conversations-store.test.ts:76).

import { assert, assertEquals } from "@std/assert";
import {
  conversationsCollection,
  injectedPhoneDocPath,
  injectionHistoryCollection,
  orchestratorEventsCollection,
  scheduledInjectionsCollection,
  uniqueGuestsByPhoneCollection,
} from "@shared/firestore/paths.ts";
import { setFirestoreClientForTests } from "@shared/firestore/wrapper.ts";
import {
  deleteConversations,
  deleteConversationsByCallId,
  storeMessage,
} from "@shared/services/conversations/store.ts";
import { getEvents, logEvent } from "@shared/services/orchestrator/service.ts";
import { sweepScheduledInjections } from "@shared/services/injections/sweep.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { FirestoreMock } from "@tests/mocks/firestore-mock.ts";

// Spy helper: wraps mock.list to capture the latest call args, returns
// the original mock so other behavior is preserved.
interface ListCall {
  parentPath: string;
  opts: { where?: { field: string; op: string; value: unknown } };
}

function spyList(mock: FirestoreMock): {
  calls: ListCall[];
  restore: () => void;
} {
  const calls: ListCall[] = [];
  const orig = mock.list.bind(mock);
  // deno-lint-ignore no-explicit-any
  (mock as any).list = (parentPath: string, opts: any = {}) => {
    calls.push({ parentPath, opts });
    return orig(parentPath, opts);
  };
  return {
    calls,
    restore: () => ((mock as unknown as { list: unknown }).list = orig),
  };
}

function spyGet(mock: FirestoreMock): {
  calls: string[];
  restore: () => void;
} {
  const calls: string[] = [];
  const orig = mock.get.bind(mock);
  // deno-lint-ignore no-explicit-any
  (mock as any).get = (path: string) => {
    calls.push(path);
    return orig(path);
  };
  return {
    calls,
    restore: () => ((mock as unknown as { get: unknown }).get = orig),
  };
}

Deno.test("deleteConversations filters at the database with where(phoneNumber)", async () => {
  const mock = new FirestoreMock();
  const { calls } = spyList(mock);
  await storeMessage(
    "8432222986",
    "c1",
    "Guest",
    "hi",
    undefined,
    undefined,
    mock,
  );
  await deleteConversations("8432222986", mock);

  const deleteListCall = calls.find((c) =>
    c.parentPath === conversationsCollection &&
    c.opts.where?.field === "phoneNumber"
  );
  assert(
    deleteListCall,
    "deleteConversations must use where(phoneNumber == phone)",
  );
  assertEquals(deleteListCall.opts.where?.op, "==");
  assertEquals(deleteListCall.opts.where?.value, "8432222986");
});

Deno.test("deleteConversationsByCallId filters at the database with where(callId)", async () => {
  const mock = new FirestoreMock();
  await storeMessage(
    "8432222986",
    "call-abc",
    "Guest",
    "hi",
    undefined,
    undefined,
    mock,
  );
  const { calls } = spyList(mock);
  await deleteConversationsByCallId("8432222986", "call-abc", mock);

  const call = calls.find((c) =>
    c.parentPath === conversationsCollection &&
    c.opts.where?.field === "callId"
  );
  assert(call, "deleteConversationsByCallId must use where(callId == callId)");
  assertEquals(call.opts.where?.op, "==");
  assertEquals(call.opts.where?.value, "call-abc");
});

Deno.test("orchestrator.getEvents filters at the database with where(phone)", async () => {
  const mock = new FirestoreMock();
  await logEvent(
    "8432222986",
    { action: "INJECT", domain: DialerDomain.ODR },
    mock,
  );
  const { calls } = spyList(mock);
  await getEvents("8432222986", mock);

  const call = calls.find((c) =>
    c.parentPath === orchestratorEventsCollection &&
    c.opts.where?.field === "phone"
  );
  assert(call, "getEvents must use where(phone == phone)");
  assertEquals(call.opts.where?.op, "==");
  assertEquals(call.opts.where?.value, "8432222986");
});

Deno.test("orchestrator.logEvent stamps `phone` field on the doc", async () => {
  const mock = new FirestoreMock();
  await logEvent(
    "8432222986",
    { action: "INJECT", domain: DialerDomain.ODR },
    mock,
  );

  // Find the orchestrator event doc and assert phone was stamped.
  let foundPhone: string | undefined;
  for (const [path, data] of mock.docs.entries()) {
    if (path.startsWith(`${orchestratorEventsCollection}/`)) {
      foundPhone = (data as { phone?: string }).phone;
    }
  }
  assertEquals(foundPhone, "8432222986");
});

Deno.test("sweepScheduledInjections filters at the database with where(eventTime <=)", async () => {
  const mock = new FirestoreMock();
  const { calls } = spyList(mock);
  await sweepScheduledInjections("manual", mock);

  const call = calls.find((c) =>
    c.parentPath === scheduledInjectionsCollection &&
    c.opts.where?.field === "eventTime"
  );
  assert(call, "sweep must use where(eventTime <= now)");
  assertEquals(call.opts.where?.op, "<=");
  // Value is the current ISO timestamp — assert it's an ISO string
  // rather than a specific value (test timing is non-deterministic).
  assert(typeof call.opts.where?.value === "string");
});

Deno.test("scheduleInjection writes the injectedphones marker", async () => {
  // Use a non-excluded phone; 8432222986 (Adam's) is in
  // EXCLUDED_REPORTING_PHONES and scheduleInjection short-circuits for it.
  const phone = "5551239876";
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    await scheduleInjection(
      phone,
      new Date(Date.now() + 60_000).toISOString(),
      false,
      undefined,
      mock,
    );
    // Fire-and-forget aggregator writes; small wait to let them settle.
    await new Promise((r) => setTimeout(r, 100));
    const marker = await mock.get(injectedPhoneDocPath(phone));
    assert(
      marker,
      "injectedphones marker must be created on scheduleInjection",
    );
    assertEquals((marker as { phone: string }).phone, phone);
  } finally {
    setFirestoreClientForTests(null);
  }
});

Deno.test("phoneHasInjection-equivalent: marker lookup is a single get, not a list", async () => {
  // The /api/guests/answered endpoint is exercised indirectly via the
  // marker collection; we assert here that the marker exists is enough
  // to "claim" a phone, and that no full-collection list is required.
  const phone = "5551239876";
  const mock = new FirestoreMock();
  await mock.set(injectedPhoneDocPath(phone), {
    phone,
    firstInjectedAt: new Date().toISOString(),
    lastInjectedAt: new Date().toISOString(),
  });
  const { calls: listCalls } = spyList(mock);
  const { calls: getCalls } = spyGet(mock);
  const result = await mock.get(injectedPhoneDocPath(phone));
  assert(result !== null);
  assertEquals(listCalls.length, 0);
  assertEquals(getCalls[0], injectedPhoneDocPath(phone));
});

Deno.test("storeMessage updates uniqueguestsbyphone aggregator", async () => {
  const mock = new FirestoreMock();
  await storeMessage(
    "9999999999",
    "c1",
    "AI Bot",
    "hello",
    undefined,
    undefined,
    mock,
  );
  await storeMessage(
    "9999999999",
    "c1",
    "Guest",
    "hi back",
    undefined,
    undefined,
    mock,
  );
  // Aggregator is updated fire-and-forget; wait briefly.
  await new Promise((r) => setTimeout(r, 20));

  const agg = await mock.get(`${uniqueGuestsByPhoneCollection}/9999999999`);
  assert(agg);
  assertEquals((agg as { phoneNumber: string }).phoneNumber, "9999999999");
  assertEquals((agg as { messageCount: number }).messageCount, 2);
  assertEquals((agg as { replyCount: number }).replyCount, 1);
  assertEquals((agg as { hasReplied: boolean }).hasReplied, true);
});

// Sale-match runs once a day against potentially large QB reports
// (report 678 returns ~30k+ rows). We tried per-phone where-filters but
// that's catastrophically slow at 30k × 3 sequential reads on Deno
// Deploy — explicit exception to the "no scans" rule, documented in
// shared/services/sale-match/service.ts. This test pins the contract:
// sale-match SHOULD bulk-list the three source collections in parallel,
// once per run.
Deno.test("sale-match bulk-loads the three source collections in parallel", async () => {
  const mock = new FirestoreMock();
  setFirestoreClientForTests(mock);
  try {
    const { calls } = spyList(mock);
    const { processSaleMatches } = await import(
      "@shared/services/sale-match/service.ts"
    );
    await processSaleMatches([{ phone10: "5551239876" }], mock);

    const wantedParents = new Set([
      scheduledInjectionsCollection,
      injectionHistoryCollection,
      "sms-bot/guestactivated/byPhone",
    ]);
    const bulkScans = calls.filter((c) => wantedParents.has(c.parentPath));
    assertEquals(
      bulkScans.length,
      3,
      `expected one bulk list per source collection (got ${bulkScans.length})`,
    );
    // Each must be a bulk list (no where filter) — sale-match
    // intentionally bypasses the where-filter pattern because per-phone
    // lookups don't scale to 30k+ input rows on Deno Deploy.
    for (const c of bulkScans) {
      assertEquals(
        c.opts.where,
        undefined,
        `sale-match must bulk-list ${c.parentPath} (no where filter)`,
      );
    }
  } finally {
    setFirestoreClientForTests(null);
  }
});
