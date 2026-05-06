// reseed-answered-conversations.ts
//
// Walks every phone in guestanswered/byPhone, finds their unique Bland call
// IDs from the conversations collection, and re-fetches each conversation
// from Bland's API. If Bland returns MORE messages than we have stored, we
// replace; otherwise we leave existing data alone (Bland may have aged the
// conversation out of their API and we'd silently nuke the only copy).
//
// Skips appt_* call IDs — those are calendar booking pseudo-ids, not real
// Bland conversation IDs.
//
// Run:
//   deno task reseed-answered-conversations [--dry-run] [--phone=PHONE10]

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";

const args = Deno.args;
const DRY_RUN = args.includes("--dry-run");
const phoneFilter = args
  .find((a) => a.startsWith("--phone="))
  ?.split("=")[1] ?? null;

const FIREBASE_PROJECT_ID = Deno.env.get("FIREBASE_PROJECT_ID")!;
const inlineJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_JSON");
const credPath = Deno.env.get("GOOGLE_APPLICATION_CREDENTIALS");
const BLAND_KEY = Deno.env.get("BLAND_API_KEY") ?? Deno.env.get("NU_BLAND_API_KEY");

if (!BLAND_KEY) {
  console.error("❌ Missing BLAND_API_KEY");
  Deno.exit(1);
}

const serviceAccount = inlineJson
  ? JSON.parse(inlineJson)
  : JSON.parse(await Deno.readTextFile(credPath!));

const app = initializeApp({
  credential: cert(serviceAccount),
  projectId: FIREBASE_PROJECT_ID,
});
const db = getFirestore(app);
db.settings({ preferRest: true });

const BLAND_BASE = "https://api.bland.ai/v1/sms/conversations";
// UUID format = real Bland conversation. appt_* = calendar-booking pseudo-id.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface BlandMsg {
  sender: string;
  message: string;
  created_at?: string;
}
interface BlandResp {
  data?: {
    user_number?: string;
    messages?: BlandMsg[];
  };
  errors?: unknown;
}

async function fetchBlandConversation(callId: string): Promise<BlandResp | null> {
  try {
    const res = await fetch(`${BLAND_BASE}/${callId}`, {
      headers: { authorization: BLAND_KEY! },
    });
    if (!res.ok) {
      const text = await res.text();
      console.warn(`  ⚠️  Bland ${res.status}: ${text.slice(0, 120)}`);
      return null;
    }
    return await res.json() as BlandResp;
  } catch (e) {
    console.warn(`  ⚠️  Fetch error: ${(e as Error).message}`);
    return null;
  }
}

async function listCallIdsForPhone(phone10: string): Promise<Map<string, number>> {
  const all = await db.collection("sms-bot/conversations/messages").get();
  const callCounts = new Map<string, number>();
  for (const d of all.docs) {
    if (!d.id.startsWith(`${phone10}__`)) continue;
    const data = d.data();
    const callId = String(data.callId ?? "");
    if (!callId) continue;
    callCounts.set(callId, (callCounts.get(callId) ?? 0) + 1);
  }
  return callCounts;
}

async function listAllConversations(): Promise<Map<string, Map<string, number>>> {
  // Returns phone10 → (callId → currentMessageCount). One Firestore read.
  const all = await db.collection("sms-bot/conversations/messages").get();
  const byPhone = new Map<string, Map<string, number>>();
  for (const d of all.docs) {
    const sep = d.id.indexOf("__");
    if (sep < 0) continue;
    const phone10 = d.id.slice(0, sep);
    const data = d.data();
    const callId = String(data.callId ?? "");
    if (!callId) continue;
    if (!byPhone.has(phone10)) byPhone.set(phone10, new Map());
    const m = byPhone.get(phone10)!;
    m.set(callId, (m.get(callId) ?? 0) + 1);
  }
  return byPhone;
}

async function deleteByCallId(phone10: string, callId: string): Promise<number> {
  const all = await db.collection("sms-bot/conversations/messages").get();
  const matching = all.docs.filter((d) => {
    if (!d.id.startsWith(`${phone10}__`)) return false;
    const data = d.data();
    return data.callId === callId;
  });
  if (matching.length === 0) return 0;
  const batch = db.batch();
  for (const d of matching) batch.delete(d.ref);
  await batch.commit();
  return matching.length;
}

async function writeMessages(
  phone10: string,
  callId: string,
  msgs: BlandMsg[],
): Promise<number> {
  let written = 0;
  // Storing one-at-a-time to mirror storeMessage's deterministic-id logic;
  // callId timestamps are unique per message so doc IDs won't collide.
  for (const m of msgs) {
    if (!m.message || m.message === "<Call Connected>") continue;
    const sender = m.sender === "USER" ? "Guest" : "AI Bot";
    const ts = m.created_at ?? new Date().toISOString();
    const docId = `${phone10}__${callId}__${ts}`;
    await db.doc(`sms-bot/conversations/messages/${docId}`).set({
      phoneNumber: phone10,
      callId,
      sender,
      message: m.message,
      timestamp: ts,
    });
    written++;
  }
  return written;
}

console.log(`🚀 reseed-answered-conversations`);
console.log(`   DRY_RUN     = ${DRY_RUN}`);
console.log(`   phoneFilter = ${phoneFilter ?? "(none)"}`);
console.log("");

console.log("🔍 Loading guestanswered + conversations from Firestore...");
const answered = await db.collection("sms-bot/guestanswered/byPhone").get();
const allByPhone = await listAllConversations();
console.log(`   answered phones: ${answered.size}`);
console.log(`   conversations:   ${[...allByPhone.values()].reduce((s, m) => s + [...m.values()].reduce((a, b) => a + b, 0), 0)} docs across ${allByPhone.size} phones`);
console.log("");

const phones = answered.docs.map((d) => d.id).filter((p) =>
  phoneFilter ? p === phoneFilter : true
);

let phonesProcessed = 0;
let callsAttempted = 0;
let callsSeeded = 0;
let messagesAdded = 0;
let callsSkippedAppt = 0;
let callsSkippedFewer = 0;
let callsErrored = 0;

for (const phone10 of phones) {
  phonesProcessed++;
  const callCounts = allByPhone.get(phone10) ?? new Map();
  const blandCalls = [...callCounts.keys()].filter((c) => UUID_RE.test(c));
  const apptCalls = [...callCounts.keys()].filter((c) => c.startsWith("appt_"));
  callsSkippedAppt += apptCalls.length;

  if (blandCalls.length === 0) {
    console.log(`[${phonesProcessed}/${phones.length}] ${phone10}  no Bland call IDs (${apptCalls.length} appt-only)`);
    continue;
  }

  console.log(`[${phonesProcessed}/${phones.length}] ${phone10}  ${blandCalls.length} Bland call(s)`);
  for (const callId of blandCalls) {
    callsAttempted++;
    const currentCount = callCounts.get(callId) ?? 0;
    const resp = await fetchBlandConversation(callId);
    if (!resp || !resp.data) {
      callsErrored++;
      console.log(`  ❌ ${callId.slice(0, 12)}…  Bland fetch failed`);
      continue;
    }
    const blandMsgs = (resp.data.messages ?? []).filter((m) =>
      m.message && m.message !== "<Call Connected>"
    );
    if (blandMsgs.length <= currentCount) {
      callsSkippedFewer++;
      console.log(`  ⏭ ${callId.slice(0, 12)}…  Bland=${blandMsgs.length}  current=${currentCount}  (no improvement, skipping)`);
      continue;
    }
    if (DRY_RUN) {
      console.log(`  🧪 ${callId.slice(0, 12)}…  Bland=${blandMsgs.length}  current=${currentCount}  → would replace (+${blandMsgs.length - currentCount})`);
      continue;
    }
    const deleted = await deleteByCallId(phone10, callId);
    const wrote = await writeMessages(phone10, callId, blandMsgs);
    callsSeeded++;
    messagesAdded += wrote - deleted;
    console.log(`  ✅ ${callId.slice(0, 12)}…  deleted=${deleted}  wrote=${wrote}  delta=+${wrote - deleted}`);
    // Tiny throttle so we don't slam Bland's API.
    await new Promise((r) => setTimeout(r, 150));
  }
}

console.log("");
console.log("=== Summary ===");
console.log(`phones processed     : ${phonesProcessed}`);
console.log(`calls attempted      : ${callsAttempted}`);
console.log(`calls re-seeded      : ${callsSeeded}`);
console.log(`calls skipped (fewer): ${callsSkippedFewer}`);
console.log(`calls skipped (appt) : ${callsSkippedAppt}`);
console.log(`calls errored        : ${callsErrored}`);
console.log(`net messages added   : ${messagesAdded}`);
if (DRY_RUN) console.log("(DRY RUN — no writes performed)");

Deno.exit(0);
