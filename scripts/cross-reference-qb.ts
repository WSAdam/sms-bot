// cross-reference-qb.ts
//
// Read /tmp/qb-verbose.json (the verbose sale-match response) and find any
// phones the cron classified as "skippedNoInjection" that actually DO have
// injection history or appointment-scheduled conversation messages on our
// side. Those are the lost sales — phones QB says sold but our matcher
// failed to credit.

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

interface QbVerbose {
  skippedNoInjectionList?: Array<{ phone10: string; activatedAt: string }>;
}

const raw = await Deno.readTextFile("/tmp/qb-verbose.json");
const qb = JSON.parse(raw) as QbVerbose;
const skipped = qb.skippedNoInjectionList ?? [];
console.log(`📋 QB says ${skipped.length} phones are sales but cron found no injection record for them`);

const qbPhones = new Set(skipped.map((s) => s.phone10));

console.log(`🔍 Loading injection history + conversations + activated...`);
const [history, conversations, activated] = await Promise.all([
  db.collection("sms-bot/injectionhistory/byPhone").get(),
  db.collection("sms-bot/conversations/messages").get(),
  db.collection("sms-bot/guestactivated/byPhone").get(),
]);
console.log(`   injectionhistory=${history.size} conversations=${conversations.size} activated=${activated.size}`);

const injectedPhones = new Map<string, number>();
for (const h of history.docs) {
  const sep = h.id.indexOf("__");
  const phone = sep >= 0 ? h.id.slice(0, sep) : h.id;
  if (!phone) continue;
  injectedPhones.set(phone, (injectedPhones.get(phone) ?? 0) + 1);
}

const apptScheduled = new Set<string>();
const anyConvoPhones = new Map<string, number>();
for (const c of conversations.docs) {
  const d = c.data();
  const phone = String(d.phoneNumber ?? "");
  if (!phone) continue;
  anyConvoPhones.set(phone, (anyConvoPhones.get(phone) ?? 0) + 1);
  const tag = String(d.nodeTag ?? "").toLowerCase();
  if (tag.includes("appointment scheduled")) apptScheduled.add(phone);
}

const activatedSet = new Set(activated.docs.map((d) => d.id));

console.log("");
console.log("=== Cross-reference: QB-sold but cron-skipped phones ===");
console.log("");

const hits: Array<{
  phone: string;
  hasInjection: boolean;
  injectionCount: number;
  hasAppt: boolean;
  convoCount: number;
  isActivated: boolean;
}> = [];

for (const s of skipped) {
  const phone = s.phone10;
  const injCount = injectedPhones.get(phone) ?? 0;
  const convoCount = anyConvoPhones.get(phone) ?? 0;
  const hasInj = injCount > 0;
  const hasAppt = apptScheduled.has(phone);
  const isAct = activatedSet.has(phone);
  // Only surface phones that have ANY of: injection, appointment, conversation
  if (!hasInj && !hasAppt && convoCount === 0) continue;
  hits.push({ phone, hasInjection: hasInj, injectionCount: injCount, hasAppt, convoCount, isActivated: isAct });
}

console.log(`🎯 ${hits.length} QB-sold phones have evidence on our side (injection/appt/convo) but cron skipped them`);
console.log("");

for (const h of hits) {
  const flags = [
    h.hasInjection ? `📤inj×${h.injectionCount}` : "",
    h.hasAppt ? "📅appt" : "",
    h.convoCount > 0 ? `💬msg×${h.convoCount}` : "",
    h.isActivated ? "✅already-activated" : "❌NOT-activated",
  ].filter(Boolean).join("  ");
  console.log(`${h.phone}  ${flags}`);
}

console.log("");
console.log("Phones marked NOT-activated with strong evidence are the lost sales.");

Deno.exit(0);
