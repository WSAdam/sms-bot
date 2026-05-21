// backfill-recipient-markers.ts
//
// Seeds the two recipient-marker collections that drive the nightly
// report's "Texts Sent (unique recipients)" metric from existing
// conversations data. Run ONCE after deploying the write-side index in
// shared/services/readymode/service.ts → recordOutboundRecipientMarkers.
// Without this backfill, the nightly report shows lifetime starting at 0
// and only growing as new outbound sends land — historical recipients
// from before the fix are invisible.
//
// What gets written:
//   1. uniquerecipientbyphone/byPhone/{phone10}
//        { phone, firstSentAt: <earliestOutboundMessageIso> }
//   2. weeklyrecipientbyphoneweek/byKey/{weekKey}__{phone10}
//        { phone, weekKey, firstSentAt: <earliestOutboundInThatWeekIso> }
//
// This is a one-time-only expensive read (full conversations scan). We
// pay it once to avoid paying it on every nightly report run.
//
// Run:
//   deno run -A scripts/backfill-recipient-markers.ts             # dry-run
//   deno run -A scripts/backfill-recipient-markers.ts -- --apply  # write

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

const CONVERSATIONS = "sms-bot/conversations/messages";
const UNIQUE_RECIPIENTS = "sms-bot/uniquerecipientbyphone/byPhone";
const WEEKLY_RECIPIENTS = "sms-bot/weeklyrecipientbyphoneweek/byKey";

// Same algorithm as shared/util/time.ts → easternMondayDateString so the
// backfilled docs key the same way the live writer does.
function easternMondayDateString(date: Date): string {
  const etNow = new Date(date.getTime() - 4 * 60 * 60 * 1000);
  const dow = etNow.getUTCDay();
  const daysSinceMonday = (dow + 6) % 7;
  const monday = new Date(etNow);
  monday.setUTCDate(etNow.getUTCDate() - daysSinceMonday);
  monday.setUTCHours(0, 0, 0, 0);
  const adjusted = new Date(monday.getTime() + 4 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(adjusted);
}

console.log(`🔁 backfill-recipient-markers  APPLY=${APPLY}`);

const earliestByPhone = new Map<string, number>();
const earliestByPhoneWeek = new Map<string, number>();

const snap = await db.collection(CONVERSATIONS).get();
console.log(`📜 scanned ${snap.size} conversation messages`);

for (const d of snap.docs) {
  const m = d.data() as Record<string, unknown>;
  const phone = typeof m.phoneNumber === "string" ? m.phoneNumber : "";
  const sender = typeof m.sender === "string" ? m.sender : "";
  if (!phone || sender === "Guest") continue;
  const tsRaw = m.timestamp;
  const ts = typeof tsRaw === "number"
    ? tsRaw
    : typeof tsRaw === "string"
    ? new Date(tsRaw).getTime()
    : NaN;
  if (!Number.isFinite(ts)) continue;

  const prevLifetime = earliestByPhone.get(phone);
  if (prevLifetime === undefined || ts < prevLifetime) {
    earliestByPhone.set(phone, ts);
  }
  const weekKey = easternMondayDateString(new Date(ts));
  const wpKey = `${weekKey}__${phone}`;
  const prevWeek = earliestByPhoneWeek.get(wpKey);
  if (prevWeek === undefined || ts < prevWeek) {
    earliestByPhoneWeek.set(wpKey, ts);
  }
}

console.log(
  `🧮 distinct lifetime recipients: ${earliestByPhone.size}`,
);
console.log(
  `🧮 distinct (week × recipient) pairs: ${earliestByPhoneWeek.size}`,
);

if (!APPLY) {
  console.log("✅ dry-run complete; re-run with --apply to write");
  Deno.exit(0);
}

let written = 0;
const BATCH_LIMIT = 400;
let batch = db.batch();
let batchCount = 0;

async function flush() {
  if (batchCount === 0) return;
  await batch.commit();
  written += batchCount;
  console.log(`  …wrote ${written} so far`);
  batch = db.batch();
  batchCount = 0;
}

for (const [phone, ms] of earliestByPhone) {
  batch.set(db.doc(`${UNIQUE_RECIPIENTS}/${phone}`), {
    phone,
    firstSentAt: new Date(ms).toISOString(),
  });
  batchCount++;
  if (batchCount >= BATCH_LIMIT) await flush();
}
await flush();

for (const [key, ms] of earliestByPhoneWeek) {
  const sep = key.indexOf("__");
  const weekKey = key.slice(0, sep);
  const phone = key.slice(sep + 2);
  batch.set(db.doc(`${WEEKLY_RECIPIENTS}/${key}`), {
    phone,
    weekKey,
    firstSentAt: new Date(ms).toISOString(),
  });
  batchCount++;
  if (batchCount >= BATCH_LIMIT) await flush();
}
await flush();

console.log(`✅ wrote ${written} recipient-marker docs`);
