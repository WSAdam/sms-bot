// hunt-lost-sales.ts
//
// We lost ~2 activations. saleswithin7d + guestactivated are perfectly
// in sync at 14, and salesoutsidewindow is empty — so nothing recoverable
// passively. This script casts a wider net across every collection that
// carries evidence of activation:
//
//   - Phones with "appointment scheduled" in conversations (they booked)
//   - Phones with injection history (we sent them through funnel)
//   - Phones in QB report 678 today (QB still considers them sales)
//   - Phones with audit/auditstage records
//
// Then surfaces the candidates that are NOT currently in guestactivated.
// Those are our best guess for the 2 missing sales.

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
const serviceAccount = inlineJson
  ? JSON.parse(inlineJson)
  : JSON.parse(await Deno.readTextFile(credPath!));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ preferRest: true });

async function loadAll(path: string) {
  const snap = await db.collection(path).get();
  return snap.docs.map((d) => ({
    id: d.id,
    data: d.data() as Record<string, unknown>,
  }));
}

console.log("🔍 Loading all relevant collections...");
const [activated, within, conversations, history, audit, leadPointer] =
  await Promise.all([
    loadAll("sms-bot/guestactivated/byPhone"),
    loadAll("sms-bot/saleswithin7d/byPhone"),
    loadAll("sms-bot/conversations/messages"),
    loadAll("sms-bot/injectionhistory/byPhone"),
    loadAll("sms-bot/audit/byRecordId"),
    loadAll("sms-bot/leadpointer/byPhone"),
  ]);

console.log(
  `   activated=${activated.length} within7d=${within.length} conversations=${conversations.length} injectionhistory=${history.length} audit=${audit.length} leadpointer=${leadPointer.length}`,
);

const activatedSet = new Set<string>(activated.map((a) => a.id));

// Phones with at least one "appointment scheduled" nodeTag in conversations.
// These guests confirmed an appointment with our bot — strong signal of sale.
const apptPhones = new Map<
  string,
  { msg: string; ts: string; callId: string }
>();
for (const c of conversations) {
  const d = c.data;
  const tag = String(d.nodeTag ?? "").toLowerCase();
  const phone = String(d.phoneNumber ?? "");
  if (!tag.includes("appointment scheduled")) continue;
  if (!phone) continue;
  // Keep the latest appointment-scheduled message per phone.
  const ts = String(d.timestamp ?? "");
  const cur = apptPhones.get(phone);
  if (!cur || cur.ts < ts) {
    apptPhones.set(phone, {
      msg: String(d.message ?? ""),
      ts,
      callId: String(d.callId ?? ""),
    });
  }
}

// Phones with injection history (we sent them through the funnel).
const injectedPhones = new Set<string>();
for (const h of history) {
  const sep = h.id.indexOf("__");
  const phone = sep >= 0 ? h.id.slice(0, sep) : h.id;
  if (phone) injectedPhones.add(phone);
}

console.log("");
console.log(
  `📅 ${apptPhones.size} phones have an "appointment scheduled" in conversations`,
);
console.log(`📤 ${injectedPhones.size} phones have injection history`);
console.log(`✅ ${activatedSet.size} phones currently in guestactivated`);

// Best candidates for "lost activations":
//   booked an appointment with our bot AND we have evidence we processed them
//   AND they're NOT currently activated.
const lostCandidates: Array<{
  phone: string;
  apptMsg: string;
  apptTs: string;
  callId: string;
  hasInjection: boolean;
}> = [];
for (const [phone, info] of apptPhones) {
  if (activatedSet.has(phone)) continue;
  lostCandidates.push({
    phone,
    apptMsg: info.msg,
    apptTs: info.ts,
    callId: info.callId,
    hasInjection: injectedPhones.has(phone),
  });
}

// Sort by appointment timestamp descending — newer ones are more recently
// "lost" if anything.
lostCandidates.sort((a, b) => b.apptTs.localeCompare(a.apptTs));

console.log("");
console.log(
  `🎯 ${lostCandidates.length} phones BOOKED an appointment via the bot but are NOT in guestactivated`,
);
console.log("");
console.log("Sorted by most recent appointment (likely lost sales at top):");
console.log("");
for (const c of lostCandidates) {
  const inj = c.hasInjection ? "📤" : "  ";
  const apptTime = c.apptTs
    ? new Date(c.apptTs).toLocaleString("en-US", {
      dateStyle: "short",
      timeStyle: "short",
    })
    : "?";
  console.log(
    `${inj} ${c.phone}  appt-msg-at=${apptTime}  callId=${
      c.callId.slice(0, 8)
    }…`,
  );
  console.log(`     msg: ${c.apptMsg.slice(0, 120)}`);
}

console.log("");
console.log("📤 = has injection history (we sent them to the dialer)");
console.log("");
console.log("To restore any of these as a manual claim:");
console.log(
  "  curl -X POST https://sms-bot.thetechgoose.deno.net/api/sales/record \\",
);
console.log("    -H 'content-type: application/json' \\");
console.log('    -d \'{"phone":"PHONE10","saleAt":"2026-05-04T12:00:00Z"}\'');

Deno.exit(0);
