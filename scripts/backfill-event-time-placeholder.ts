// backfill-event-time-placeholder.ts
//
// Tags historical injectionhistory + guestactivated docs so the dashboard
// can render placeholder eventTimes correctly.
//
// Two collections, two passes:
//
// 1) injectionhistory: any doc whose eventTime === firedAt is a
//    placeholder write — both `booking-scan-recovery` (real-time
//    recovery when the appt time couldn't be parsed) and
//    `answered-backfill` (historical bulk-tag) use this shape. Set
//    eventTimePlaceholder=true on all of them.
//
// 2) guestactivated: any doc whose matched eventTime came from a
//    placeholder injectionhistory record. We detect this by re-doing the
//    nearest-appt match using the updated injectionhistory set: if the
//    closest appointment for the phone has eventTimePlaceholder=true,
//    set the same flag on guestactivated.
//
// Idempotent. Dry-run by default.
//
// Run:
//   deno task backfill-event-time-placeholder              # dry-run
//   deno task backfill-event-time-placeholder -- --apply   # apply

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

const APPLY = Deno.args.includes("--apply");

const INJECTION_HISTORY = "sms-bot/injectionhistory/byPhone";
const GUEST_ACTIVATED = "sms-bot/guestactivated/byPhone";

console.log(`🔁 backfill-event-time-placeholder  APPLY=${APPLY}\n`);

// PASS 1 — flag injectionhistory recovery placeholders -----------------------
console.log("1️⃣  scanning injectionhistory…");
const ih = await db.collection(INJECTION_HISTORY).get();
const placeholderPhones = new Map<string, string>(); // phone10 -> eventTime
let ihUpdates = 0;
const ihBatch = db.batch();
const ihByFiredBy: Record<string, number> = {};
for (const d of ih.docs) {
  const data = d.data() as Record<string, unknown>;
  const eventTime = data.eventTime;
  const firedAt = data.firedAt;
  if (typeof eventTime !== "string" || typeof firedAt !== "string") continue;
  // Placeholder marker: eventTime equals firedAt (no real appt parsed).
  if (eventTime !== firedAt) continue;
  if (data.eventTimePlaceholder === true) continue; // already tagged
  const phone = String(data.phone ?? "");
  if (!phone) continue;
  placeholderPhones.set(phone, eventTime);
  ihUpdates++;
  const tag = String(data.firedBy ?? "(none)");
  ihByFiredBy[tag] = (ihByFiredBy[tag] ?? 0) + 1;
  if (APPLY) ihBatch.update(d.ref, { eventTimePlaceholder: true });
}
console.log(`   placeholder docs to flag: ${ihUpdates}`);
for (const [k, v] of Object.entries(ihByFiredBy)) {
  console.log(`     firedBy=${k}: ${v}`);
}

// PASS 2 — propagate to guestactivated whose eventTime came from one of these
console.log("\n2️⃣  scanning guestactivated…");
const ga = await db.collection(GUEST_ACTIVATED).get();
let gaUpdates = 0;
const gaBatch = db.batch();
for (const d of ga.docs) {
  const data = d.data() as Record<string, unknown>;
  if (data.eventTimePlaceholder === true) continue;
  const phone = String(data.phone10 ?? d.id);
  const eventTime = data.eventTime;
  if (typeof eventTime !== "string") continue;
  // If this phone has a placeholder injectionhistory record AND the
  // guestactivated.eventTime matches that placeholder eventTime, the
  // guestactivated row is sourced from a placeholder.
  const placeholderEt = placeholderPhones.get(phone);
  if (placeholderEt !== eventTime) continue;
  gaUpdates++;
  if (APPLY) gaBatch.update(d.ref, { eventTimePlaceholder: true });
  console.log(`   ${phone}  activatedAt=${data.activatedAt}  eventTime=${eventTime}`);
}
console.log(`\n   guestactivated docs to flag: ${gaUpdates}`);

if (!APPLY) {
  console.log("\n(DRY RUN — pass --apply to mutate)");
  Deno.exit(0);
}

console.log("\n🚧 applying…");
if (ihUpdates > 0) await ihBatch.commit();
if (gaUpdates > 0) await gaBatch.commit();
console.log(`\n✅ done. injectionhistory: ${ihUpdates} updated, guestactivated: ${gaUpdates} updated`);
Deno.exit(0);
