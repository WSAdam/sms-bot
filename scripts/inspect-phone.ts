// Dump every Firestore doc related to a single phone — built for
// debugging "why did booking-scan / sale-match skip this phone?" or
// "what state is this lead in right now?". Read-only, no writes.
//
// Pulls in parallel:
//   - scheduledinjections/byPhone/{phone}        (pending booking)
//   - guestactivated/byPhone/{phone}             (credited sale)
//   - guestanswered/byPhone/{phone}              (answered an inbound call)
//   - injectedphones/byPhone/{phone}             (marker from new write-side index)
//   - leadpointer/byPhone/{phone}                (orchestrator state)
//   - uniqueguestsbyphone/byPhone/{phone}        (dashboard aggregator)
//   - injectionhistory entries where phone == X  (all fired injections)
//   - orchestratorevents where phone == X        (audit trail)
//   - conversations/messages where phoneNumber == X (every message we've stored)
//   - injectionhistory entries where recoveredFromCallId in this phone's callIds
//     (prior booking-scan recoveries that would skip this conversation)
//
// Usage:
//   deno run -A --env-file=env/local scripts/inspect-phone.ts 7164674843

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  guestActivatedDocPath,
  guestAnsweredDocPath,
  injectedPhoneDocPath,
  injectionHistoryCollection,
  leadPointerDocPath,
  orchestratorEventsCollection,
  scheduledInjectionDocPath,
  uniqueGuestByPhoneDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const phone10 = (Deno.args[0] ?? "").replace(/\D/g, "").slice(-10);
if (!/^\d{10}$/.test(phone10)) {
  console.error(
    "❌ Pass a 10-digit phone number, e.g.: deno run -A scripts/inspect-phone.ts 7164674843",
  );
  Deno.exit(1);
}

const db = getFirestoreClient();
console.log(`🔍 inspect-phone: ${phone10}`);
if (isExcludedFromReporting(phone10)) {
  console.log("⚠️  This phone is in EXCLUDED_REPORTING_PHONES — every");
  console.log("    booking-scan / sale-match path short-circuits it.");
}

const [
  scheduled,
  activated,
  answered,
  injectedMarker,
  pointer,
  uniqueGuest,
  history,
  events,
  conversationMsgs,
] = await Promise.all([
  db.get(scheduledInjectionDocPath(phone10)),
  db.get(guestActivatedDocPath(phone10)),
  db.get(guestAnsweredDocPath(phone10)),
  db.get(injectedPhoneDocPath(phone10)),
  db.get(leadPointerDocPath(phone10)),
  db.get(uniqueGuestByPhoneDocPath(phone10)),
  db.list(injectionHistoryCollection, {
    where: { field: "phone", op: "==", value: phone10 },
    limit: 200,
  }),
  db.list(orchestratorEventsCollection, {
    where: { field: "phone", op: "==", value: phone10 },
    limit: 200,
  }),
  db.list(conversationsCollection, {
    where: { field: "phoneNumber", op: "==", value: phone10 },
    limit: 1000,
  }),
]);

function section(name: string, body: unknown): void {
  console.log("");
  console.log(`━━━ ${name} ━━━`);
  if (body === null) {
    console.log("  (no doc)");
    return;
  }
  if (Array.isArray(body)) {
    console.log(`  ${body.length} doc(s)`);
    for (const item of body) {
      console.log(JSON.stringify(item, null, 2));
    }
    return;
  }
  console.log(JSON.stringify(body, null, 2));
}

section("scheduledinjections/byPhone (pending)", scheduled);
section("guestactivated/byPhone (credited sale)", activated);
section("guestanswered/byPhone", answered);
section("injectedphones/byPhone (write-side marker)", injectedMarker);
section("leadpointer/byPhone (orchestrator)", pointer);
section("uniqueguestsbyphone/byPhone (aggregator)", uniqueGuest);
section(
  "injectionhistory (where phone == X)",
  history.map((e) => ({ id: e.id, ...(e.data as Record<string, unknown>) })),
);
section(
  "orchestratorevents (where phone == X, last 200)",
  events.map((e) => ({ id: e.id, ...(e.data as Record<string, unknown>) })),
);

// Group conversation messages by callId so it's obvious which Bland
// conversation each came from. This is what booking-scan iterates over.
const byCallId = new Map<
  string,
  Array<Record<string, unknown> & { id: string }>
>();
for (const e of conversationMsgs) {
  const d = e.data as Record<string, unknown>;
  const cid = String(d.callId ?? "(no-callId)");
  const arr = byCallId.get(cid) ?? [];
  arr.push({ id: e.id, ...d });
  byCallId.set(cid, arr);
}

console.log("");
console.log(`━━━ conversations/messages (where phoneNumber == X) ━━━`);
console.log(
  `  ${conversationMsgs.length} message(s) across ${byCallId.size} callId(s)`,
);
for (const [cid, msgs] of byCallId) {
  console.log("");
  console.log(`  callId=${cid}  (${msgs.length} messages)`);
  msgs.sort((a, b) =>
    String(a.timestamp ?? "") < String(b.timestamp ?? "") ? -1 : 1
  );
  for (const m of msgs) {
    const ts = String(m.timestamp ?? "").slice(0, 19);
    const sender = String(m.sender ?? "?");
    const text = String(m.message ?? "").slice(0, 100);
    const tag = m.nodeTag ? ` [${m.nodeTag}]` : "";
    console.log(`    [${ts}] ${sender}${tag}: ${text}`);
  }
}

// Cross-check: any injectionhistory doc with recoveredFromCallId pointing
// at one of this phone's callIds? If yes, a prior booking-scan run wrote
// that recovery — and the current booking-scan would skip the conversation
// via the "already recovered" check.
console.log("");
console.log(`━━━ Prior booking-scan recoveries for this phone's callIds ━━━`);
if (byCallId.size === 0) {
  console.log("  (no conversations to cross-check)");
} else {
  const recoveryHits: Array<
    { recoveredFromCallId: string; doc: Record<string, unknown> }
  > = [];
  for (const cid of byCallId.keys()) {
    const matches = await db.list(injectionHistoryCollection, {
      where: { field: "recoveredFromCallId", op: "==", value: cid },
      limit: 5,
    });
    for (const m of matches) {
      recoveryHits.push({
        recoveredFromCallId: cid,
        doc: { id: m.id, ...(m.data as Record<string, unknown>) },
      });
    }
  }
  if (recoveryHits.length === 0) {
    console.log("  (none)");
  } else {
    for (const hit of recoveryHits) {
      console.log(`  recoveredFromCallId=${hit.recoveredFromCallId}`);
      console.log(JSON.stringify(hit.doc, null, 2));
    }
  }
}

console.log("");
console.log("✅ done");
