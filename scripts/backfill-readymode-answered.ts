// backfill-readymode-answered.ts
//
// Rebuilds the readymode-sourced guestanswered set in place from the truth
// in calldispositions, applying the corrected rules:
//
//   1) "answered" requires the phone to be in our funnel — defined the same
//      way the dashboard's "Booked" count defines it: a doc exists in
//      scheduledinjections, injectionhistory, or guestactivated. RM's
//      portal logs include calls to phones we never put into the dialer
//      (other teams, manual dials), and the original cron upserted
//      guestanswered for all of them — that's how the dashboard ended up
//      with 543 answered vs 166 booked. Answered must stay ⊆ booked.
//
//   2) "non-answered" uses substring match on "no answer" (case-insensitive)
//      so team-prefixed dispositions like "ODR No Answer" / "2ND No Answer"
//      are excluded — the original Set check only caught the bare string.
//
//   3) HTML entities in transfer dispositions ("&rArr; Andrew Torsiello")
//      are decoded before storing.
//
// Only mutates guestanswered docs whose source === "readymode-call-log".
// Other sources (sms-callback, sale-match auto-write) are left alone.
//
// Run:
//   deno task backfill-readymode-answered             # dry-run
//   deno task backfill-readymode-answered -- --apply  # actually mutate

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

const CALLDISPOSITIONS = "sms-bot/calldispositions/byPhone";
const GUESTANSWERED = "sms-bot/guestanswered/byPhone";
const SCHEDULED_INJECTIONS = "sms-bot/scheduledinjections/byPhone";
const INJECTION_HISTORY = "sms-bot/injectionhistory/byPhone";
const GUEST_ACTIVATED = "sms-bot/guestactivated/byPhone";

const READYMODE_SOURCE = "readymode-call-log";

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&rArr;/g, "⇒")
    .replace(/&rarr;/g, "→")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

function isNonAnswered(disposition: string): boolean {
  const norm = disposition.toLowerCase().trim();
  if (norm === "test") return true;
  if (norm.includes("no answer")) return true;
  return false;
}

console.log(`🔁 backfill-readymode-answered`);
console.log(`   APPLY = ${APPLY}`);
console.log("");

// 1) Walk calldispositions, group by phone, keep earliest answered call.
console.log("📞 reading calldispositions…");
const earliestAnswered = new Map<
  string,
  { callTime: string; disposition: string }
>();
let dispositionsScanned = 0;
{
  const snap = await db.collection(CALLDISPOSITIONS).get();
  for (const d of snap.docs) {
    dispositionsScanned++;
    const data = d.data() as Record<string, unknown>;
    const phone10 = String(data.phone10 ?? "");
    const callTime = String(data.callTime ?? "");
    const rawDispo = String(data.disposition ?? "");
    if (!phone10 || !callTime || !rawDispo) continue;
    const dispo = decodeHtmlEntities(rawDispo);
    if (isNonAnswered(dispo)) continue;
    const cur = earliestAnswered.get(phone10);
    if (!cur || callTime < cur.callTime) {
      earliestAnswered.set(phone10, { callTime, disposition: dispo });
    }
  }
}
console.log(
  `   scanned ${dispositionsScanned} dispositions; ${earliestAnswered.size} phones have ≥1 true-answered call`,
);

// 2) Build the "in our funnel" set: union of scheduledinjections,
//    injectionhistory (id is `{phone}__{ts}`), and guestactivated. Mirrors
//    the dashboard's "Appointments Booked" universe.
console.log("🎯 building in-funnel phone set…");
const inFunnel = new Set<string>();
{
  const [pending, history, activated] = await Promise.all([
    db.collection(SCHEDULED_INJECTIONS).select().get(),
    db.collection(INJECTION_HISTORY).select().get(),
    db.collection(GUEST_ACTIVATED).select().get(),
  ]);
  for (const d of pending.docs) inFunnel.add(d.id);
  for (const d of history.docs) {
    const sep = d.id.indexOf("__");
    inFunnel.add(sep > 0 ? d.id.slice(0, sep) : d.id);
  }
  for (const d of activated.docs) inFunnel.add(d.id);
}
const candidatePhones = Array.from(earliestAnswered.keys());
const candidatesInFunnel = candidatePhones.filter((p) => inFunnel.has(p));
console.log(
  `   funnel size: ${inFunnel.size} phones; ${candidatesInFunnel.length} of ${candidatePhones.length} answered candidates are in funnel`,
);

// 3) Walk guestanswered, collect readymode-sourced docs.
console.log("📥 reading guestanswered…");
const readymodeAnswered = new Map<string, Record<string, unknown>>();
let guestansweredScanned = 0;
let nonReadymodeCount = 0;
{
  const snap = await db.collection(GUESTANSWERED).get();
  for (const d of snap.docs) {
    guestansweredScanned++;
    const data = d.data() as Record<string, unknown>;
    if (data.source === READYMODE_SOURCE) {
      readymodeAnswered.set(d.id, data);
    } else {
      nonReadymodeCount++;
    }
  }
}
console.log(
  `   scanned ${guestansweredScanned} guestanswered (${readymodeAnswered.size} readymode-sourced, ${nonReadymodeCount} other-sourced — leaving the latter alone)`,
);

// 4) Reconcile.
//    - Delete: readymode-sourced guestanswered whose phone is NOT in funnel
//      (or has no true-answered call after re-applying the substring rule).
//    - Update: readymode-sourced guestanswered whose answeredAt or
//      lastDisposition disagrees with the recomputed truth.
//    - Create: phone is in funnel + has true-answered call, but no
//      guestanswered doc exists at all yet (nothing to overwrite from
//      another source either).
const toDelete: string[] = [];
const toUpdate: { phone: string; data: Record<string, unknown> }[] = [];
const toCreate: { phone: string; data: Record<string, unknown> }[] = [];

for (const [phone, doc] of readymodeAnswered) {
  if (!inFunnel.has(phone) || !earliestAnswered.has(phone)) {
    toDelete.push(phone);
    continue;
  }
  const truth = earliestAnswered.get(phone)!;
  const curAt = typeof doc.answeredAt === "string" ? doc.answeredAt : null;
  const curDispo = typeof doc.lastDisposition === "string"
    ? doc.lastDisposition
    : null;
  if (curAt !== truth.callTime || curDispo !== truth.disposition) {
    toUpdate.push({
      phone,
      data: {
        phone10: phone,
        answered: true,
        answeredAt: truth.callTime,
        source: READYMODE_SOURCE,
        lastDisposition: truth.disposition,
      },
    });
  }
}

// For "create": only when nothing exists at all (don't overwrite a non-
// readymode source — those came from SMS / sale-match and represent a
// stronger signal). Need to check the FULL guestanswered map, not just
// readymode-sourced.
const allAnsweredIds = new Set<string>();
{
  const snap = await db.collection(GUESTANSWERED).select().get();
  for (const d of snap.docs) allAnsweredIds.add(d.id);
}
for (const phone of inFunnel) {
  if (allAnsweredIds.has(phone)) continue;
  const truth = earliestAnswered.get(phone);
  if (!truth) continue;
  toCreate.push({
    phone,
    data: {
      phone10: phone,
      answered: true,
      answeredAt: truth.callTime,
      source: READYMODE_SOURCE,
      lastDisposition: truth.disposition,
    },
  });
}

console.log("");
console.log(`📋 plan:`);
console.log(`   delete (out-of-funnel readymode docs): ${toDelete.length}`);
console.log(`   update (truth changed):                ${toUpdate.length}`);
console.log(`   create (in-funnel, no doc yet):        ${toCreate.length}`);
console.log(
  `   final readymode-sourced count: ${
    readymodeAnswered.size - toDelete.length + toCreate.length
  }`,
);
console.log(
  `   plus ${nonReadymodeCount} non-readymode guestanswered (untouched)`,
);
console.log("");

if (toDelete.length === 0 && toUpdate.length === 0 && toCreate.length === 0) {
  console.log("✅ already consistent. nothing to do.");
  Deno.exit(0);
}

if (!APPLY) {
  console.log("(DRY RUN — pass --apply to actually mutate)");
  console.log("");
  console.log("sample deletes (up to 10):");
  for (const p of toDelete.slice(0, 10)) console.log(`   - ${p}`);
  console.log("sample updates (up to 5):");
  for (const u of toUpdate.slice(0, 5)) {
    console.log(
      `   ~ ${u.phone} → ${u.data.answeredAt} ${u.data.lastDisposition}`,
    );
  }
  console.log("sample creates (up to 5):");
  for (const c of toCreate.slice(0, 5)) {
    console.log(
      `   + ${c.phone} → ${c.data.answeredAt} ${c.data.lastDisposition}`,
    );
  }
  Deno.exit(0);
}

console.log("🚧 applying…");
const writer = db.bulkWriter();
for (const phone of toDelete) {
  writer.delete(db.doc(`${GUESTANSWERED}/${phone}`));
}
for (const u of toUpdate) {
  writer.set(db.doc(`${GUESTANSWERED}/${u.phone}`), u.data);
}
for (const c of toCreate) {
  writer.set(db.doc(`${GUESTANSWERED}/${c.phone}`), c.data);
}
await writer.close();
console.log("");
console.log("✅ done");
Deno.exit(0);
