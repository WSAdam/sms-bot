// cleanup-excluded-phones.ts
//
// Walks every per-phone collection and deletes any doc keyed to a phone
// in EXCLUDED_REPORTING_PHONES (Adam's test phone, Edwin's, etc.). Use
// after a stray write — e.g. when the booking-scan or a webhook accepted
// a test-phone payload before the centralized guard was in place.
//
// Conversations are NOT touched: we want test traffic preserved for
// debugging, and the dashboard already filters them out at read time.
//
// Run:
//   deno task cleanup-excluded-phones                # dry-run
//   deno task cleanup-excluded-phones -- --apply     # actually delete

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

// Mirror constants.ts EXCLUDED_REPORTING_PHONES — kept inline here so this
// script can run standalone without the deno-task pipeline.
const EXCLUDED_PHONES = new Set<string>([
  "8432222986", // Adam's test phone
  "6098583137", // Edwin
]);

// Per-phone collections where the doc id IS the phone10 (single doc per phone).
const PER_PHONE_DOC_COLLECTIONS = [
  "sms-bot/scheduledinjections/byPhone",
  "sms-bot/guestactivated/byPhone",
  "sms-bot/guestanswered/byPhone",
  "sms-bot/saleswithin7d/byPhone",
  "sms-bot/salesoutsidewindow/byPhone",
  "sms-bot/leadpointer/byPhone",
  "sms-bot/smsflowcontext/byPhone",
];

// Collections where the doc id is `${phone10}__...` so we match by prefix.
const PER_PHONE_PREFIX_COLLECTIONS = [
  "sms-bot/injectionhistory/byPhone",
  "sms-bot/orchestratorevents/byPhone",
];

console.log(`🧹 cleanup-excluded-phones`);
console.log(`   APPLY = ${APPLY}`);
console.log(`   phones = ${[...EXCLUDED_PHONES].join(", ")}`);
console.log("");

let totalScanned = 0;
let totalToDelete = 0;
const toDelete: string[] = [];

for (const path of PER_PHONE_DOC_COLLECTIONS) {
  for (const phone of EXCLUDED_PHONES) {
    const ref = db.doc(`${path}/${phone}`);
    const snap = await ref.get();
    totalScanned++;
    if (snap.exists) {
      console.log(`  ${path}/${phone}  → exists`);
      toDelete.push(`${path}/${phone}`);
    }
  }
}

for (const path of PER_PHONE_PREFIX_COLLECTIONS) {
  const all = await db.collection(path).get();
  totalScanned += all.size;
  for (const d of all.docs) {
    const sep = d.id.indexOf("__");
    const phone = sep > 0 ? d.id.slice(0, sep) : d.id;
    if (!EXCLUDED_PHONES.has(phone)) continue;
    console.log(`  ${path}/${d.id}  → matches ${phone}`);
    toDelete.push(`${path}/${d.id}`);
  }
}

totalToDelete = toDelete.length;

console.log("");
console.log(`📋 scanned: ${totalScanned} doc-paths`);
console.log(`🗑  to delete: ${totalToDelete}`);
console.log("");

if (totalToDelete === 0) {
  console.log("✅ nothing to clean.");
  Deno.exit(0);
}

if (!APPLY) {
  console.log("(DRY RUN — pass --apply to actually delete)");
  Deno.exit(0);
}

let deleted = 0;
for (const path of toDelete) {
  await db.doc(path).delete();
  deleted++;
  console.log(`  ✅ deleted ${path}`);
}
console.log("");
console.log(`🎉 deleted ${deleted} docs`);
Deno.exit(0);
