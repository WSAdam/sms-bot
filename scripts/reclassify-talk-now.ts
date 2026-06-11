// reclassify-talk-now.ts
//
// For every injectionhistory doc currently flagged as
// eventTimePlaceholder=true with firedBy in {answered-backfill,
// manual-alignment-backfill, booking-scan-recovery}, scan the phone's
// Bland conversation messages for a clear "talk now" signal:
//
//   Bot says something like "is this a good time to talk?"
//   Guest replies affirmatively ("yes", "yes please", "now would be good", etc.)
//
// When found, we know the historical record represents a real talk-now
// inject (not a missing-data placeholder). Re-stamp it as:
//   firedBy: "talk-now"
//   eventTimePlaceholder: false (the appointment IS the inject moment)
//
// Also propagate the flag clear onto the corresponding guestactivated
// doc so the dashboard column flips from "no time recorded" to a real
// timestamp. The eventTime stays as the firedAt timestamp — that's the
// moment we actually called.
//
// Dry-run by default.
//
// Run:
//   deno task reclassify-talk-now             # dry-run
//   deno task reclassify-talk-now -- --apply

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

const IH = "sms-bot/injectionhistory/byPhone";
const GA = "sms-bot/guestactivated/byPhone";
const CONVO = "sms-bot/conversations/messages";

// Patterns that strongly indicate a talk-now flow. The bot asks "is now
// a good time" / "should I call now" / "want me to ring you" and the
// guest replies affirmatively. Lower-bar detection: bot AND guest both
// have to match for it to count.
const BOT_NOW_PROMPTS = [
  /is\s+(this|now)\s+a?\s*good\s+time/i,
  /good\s+time\s+to\s+talk/i,
  /call\s+(you\s+)?(now|right\s+now|right\s+this\s+(second|moment)|right\s+away)/i,
  /ring\s+you\s+(now|right\s+now|right\s+this\s+(second|moment)|right\s+away)/i,
  /(let|let's)\s+find\s+a\s+time/i,
  /specialist\s+(give\s+you\s+a\s+ring|reach\s+out\s+immediately|call\s+you)/i,
  /right\s+this\s+(second|moment)/i,
  /reach\s+out\s+(immediately|right\s+away)/i,
];
const GUEST_AFFIRMATIVE = [
  /^\s*y(es|eah|up|ep)?\s*[.!]?\s*$/i,
  /^\s*sure\s*[.!]?\s*$/i,
  /now\s+(is|would|works|sounds)/i,
  /now\s+would\s+be\s+(good|great|fine)/i,
  /yes,?\s+(let'?s|please|now)/i,
  /^\s*ok(ay)?\s*[.!]?\s*$/i,
  // Guests often respond with availability framing instead of bare yes.
  /^\s*any\s*time(\s+today)?/i,
  /^\s*sounds\s+good/i,
];

interface Convo {
  who: string;
  msg: string;
  ts: string;
}

async function loadConvoForPhone(phone: string): Promise<Convo[]> {
  const all = await db.collection(CONVO).get();
  const matching = all.docs.filter((d) => d.id.startsWith(phone + "__"));
  matching.sort((a, b) => a.id.localeCompare(b.id));
  return matching.map((d) => {
    const data = d.data();
    return {
      who: String(data.sender ?? "").toUpperCase(),
      msg: String(data.message ?? ""),
      ts: String(data.created_at ?? ""),
    };
  });
}

function hasTalkNowFlow(convo: Convo[]): { found: boolean; evidence: string } {
  // Walk pairs (bot prompt → guest reply). If a bot prompt matches AND
  // is followed (within 8 messages, before the next bot prompt) by a
  // guest affirmative, count it. The wider window catches chatty guests
  // who send several follow-up messages before circling back to "yes".
  for (let i = 0; i < convo.length; i++) {
    const m = convo[i];
    if (m.who !== "AI BOT" && m.who !== "AGENT" && m.who !== "BOT") continue;
    if (!BOT_NOW_PROMPTS.some((re) => re.test(m.msg))) continue;
    for (let j = i + 1; j < Math.min(convo.length, i + 9); j++) {
      const r = convo[j];
      if (r.who === "AI BOT" || r.who === "AGENT" || r.who === "BOT") break;
      if (r.who !== "GUEST" && r.who !== "USER") continue;
      if (GUEST_AFFIRMATIVE.some((re) => re.test(r.msg))) {
        return {
          found: true,
          evidence: `bot: "${m.msg.slice(0, 80)}" → guest: "${
            r.msg.slice(0, 60)
          }"`,
        };
      }
    }
  }
  return { found: false, evidence: "" };
}

console.log(`🔁 reclassify-talk-now  APPLY=${APPLY}\n`);

// 1. Find all placeholder ih docs we previously tagged.
const ih = await db.collection(IH).get();
const candidates: Array<
  { id: string; phone: string; firedBy: string; eventTime: string }
> = [];
for (const d of ih.docs) {
  const data = d.data() as Record<string, unknown>;
  if (data.eventTimePlaceholder !== true) continue;
  candidates.push({
    id: d.id,
    phone: String(data.phone ?? ""),
    firedBy: String(data.firedBy ?? ""),
    eventTime: String(data.eventTime ?? ""),
  });
}
console.log(`📋 placeholder ih candidates: ${candidates.length}`);

// 2. For each, load convo + scan for talk-now flow.
const toFlip: typeof candidates = [];
const noEvidence: typeof candidates = [];
for (const c of candidates) {
  const convo = await loadConvoForPhone(c.phone);
  if (convo.length === 0) {
    noEvidence.push(c);
    continue;
  }
  const r = hasTalkNowFlow(convo);
  if (r.found) {
    console.log(`  ✅ ${c.phone}  ${c.firedBy}  ${r.evidence}`);
    toFlip.push(c);
  } else {
    noEvidence.push(c);
  }
}

console.log(`\n📊 to reclassify as talk-now: ${toFlip.length}`);
console.log(
  `   no talk-now evidence (leave as placeholder): ${noEvidence.length}`,
);
for (const c of noEvidence) {
  console.log(
    `   - ${c.phone}  ${c.firedBy}  convo: empty or no talk-now match`,
  );
}

if (toFlip.length === 0) {
  console.log("\n✅ nothing to reclassify.");
  Deno.exit(0);
}

if (!APPLY) {
  console.log("\n(DRY RUN — pass --apply to mutate)");
  Deno.exit(0);
}

console.log("\n🚧 applying…");
const batch = db.batch();
for (const c of toFlip) {
  batch.update(db.doc(`${IH}/${c.id}`), {
    firedBy: "talk-now",
    eventTimePlaceholder: false,
    reclassifiedAt: new Date().toISOString(),
    reclassifiedReason:
      "Bland conversation shows explicit talk-now flow (bot prompt + guest affirmative); the synthetic backfill record is hiding a real talk-now event.",
  });
  // Also clear the placeholder flag on the matching guestactivated doc.
  const gaRef = db.doc(`${GA}/${c.phone}`);
  const gaSnap = await gaRef.get();
  if (gaSnap.exists && gaSnap.data()?.eventTimePlaceholder === true) {
    batch.update(gaRef, { eventTimePlaceholder: false });
  }
}
await batch.commit();
console.log(`\n✅ reclassified ${toFlip.length} ih docs.`);
Deno.exit(0);
