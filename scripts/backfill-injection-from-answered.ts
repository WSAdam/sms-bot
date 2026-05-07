// backfill-injection-from-answered.ts
//
// Every guestanswered record represents a real injection that fired (the
// dialer answered the call) — but ~43 phones in guestanswered have no
// injectionhistory entry, likely because the legacy system's injection
// history didn't migrate cleanly. This script synthesizes a history doc
// for each missing phone using the answeredAt timestamp as eventTime +
// firedAt, marked firedBy:"answered-backfill" so they're distinguishable
// from real cron fires.
//
// After this runs the lifetime Appointments Booked count and Answered
// count line up: every answered phone has an injection record.
//
// Run:
//   deno task backfill-injection-from-answered                # dry-run
//   deno task backfill-injection-from-answered -- --apply

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

const EXCLUDED_PHONES = new Set<string>([
  "8432222986",
  "6098583137",
]);

console.log(`🩹 backfill-injection-from-answered`);
console.log(`   APPLY = ${APPLY}`);
console.log("");

const [answered, history, pending] = await Promise.all([
  db.collection("sms-bot/guestanswered/byPhone").get(),
  db.collection("sms-bot/injectionhistory/byPhone").get(),
  db.collection("sms-bot/scheduledinjections/byPhone").get(),
]);

const injectedPhones = new Set<string>();
for (const d of history.docs) {
  const sep = d.id.indexOf("__");
  injectedPhones.add(sep > 0 ? d.id.slice(0, sep) : d.id);
}
for (const d of pending.docs) injectedPhones.add(d.id);

console.log(`📋 answered: ${answered.size}`);
console.log(`📋 injected (unique phones): ${injectedPhones.size}`);
console.log("");

interface MissingRow {
  phone10: string;
  answeredAt: string;
}
const missing: MissingRow[] = [];
for (const d of answered.docs) {
  const phone10 = d.id;
  if (injectedPhones.has(phone10)) continue;
  if (EXCLUDED_PHONES.has(phone10)) continue;
  const data = d.data() as Record<string, unknown>;
  const answeredAt = typeof data.answeredAt === "string" ? data.answeredAt : "";
  if (!answeredAt) {
    console.warn(`  ⚠️  ${phone10} has no answeredAt — skipping`);
    continue;
  }
  missing.push({ phone10, answeredAt });
}

console.log(`🩹 phones to backfill: ${missing.length}`);
for (const m of missing) {
  console.log(`   ${m.phone10}  answeredAt=${m.answeredAt}`);
}
console.log("");

if (missing.length === 0) {
  console.log("✅ nothing to backfill");
  Deno.exit(0);
}
if (!APPLY) {
  console.log(`(DRY RUN — pass --apply to actually write ${missing.length} injectionhistory docs)`);
  Deno.exit(0);
}

const batchSize = 400;
let written = 0;
for (let i = 0; i < missing.length; i += batchSize) {
  const chunk = missing.slice(i, i + batchSize);
  const batch = db.batch();
  for (const m of chunk) {
    const docId = `${m.phone10}__${m.answeredAt}`;
    const ref = db.doc(`sms-bot/injectionhistory/byPhone/${docId}`);
    batch.set(ref, {
      phone: m.phone10,
      eventTime: m.answeredAt,
      scheduledAt: new Date(m.answeredAt).getTime(),
      isTest: false,
      firedAt: m.answeredAt,
      firedBy: "answered-backfill",
      status: "success",
      backfillReason:
        "synthesized from guestanswered record — original injectionhistory missing (likely legacy migration gap)",
    });
  }
  await batch.commit();
  written += chunk.length;
  console.log(`   ✍️  wrote ${written}/${missing.length}`);
}

console.log("");
console.log(`🎉 backfilled ${written} injectionhistory docs`);
Deno.exit(0);
