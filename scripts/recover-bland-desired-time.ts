// recover-bland-desired-time.ts
//
// Bland exposes `variables.Desired_Time` on each conversation — the
// canonical appointment time the bot parsed and locked in. Our
// booking-scan today reads the stored MESSAGES and tries to parse
// English ("tomorrow morning") and frequently fails, leaving
// eventTimePlaceholder=true. But Bland already has the structured
// answer.
//
// This script pulls `variables.Desired_Time` for every placeholder ih
// doc, sanity-checks the value (must be within (-1h, +90d) of the
// conversation's now_utc), and if valid:
//   - re-stamps the ih with the parsed eventTime
//   - sets firedBy: "bland-variable-recovery"
//   - clears eventTimePlaceholder
//   - propagates the time + flag-clear onto the matching guestactivated
//
// Bogus stale Desired_Time values (e.g. 2 years before the conversation,
// inherited from upstream lead-source fields) get rejected and the
// placeholder tag stands.
//
// Run:
//   deno task recover-bland-desired-time              # dry-run
//   deno task recover-bland-desired-time -- --apply

import { cert, initializeApp } from "npm:firebase-admin@12/app";
import { getFirestore } from "npm:firebase-admin@12/firestore";
import {
  getConversation,
  searchConversationsByPhone,
} from "@shared/services/bland/client.ts";

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

// Vacation bookings can land months out. Cap at 180 days — wider than
// that is almost certainly a stale upstream value (we saw a 2024-04-24
// inherited from a lead source field for a 2026 sale).
const MAX_FUTURE_MS = 180 * 24 * 60 * 60 * 1000;
// Allow Desired_Time slightly before now_utc to cover talk-now and
// "give me a call in a few minutes" cases.
const SANITY_PAST_TOLERANCE_MS = 4 * 60 * 60 * 1000; // 4h

// Common IANA-timezone → UTC-offset shortcut. The conversation `timezone`
// field is usually one of these. We use it to interpret naive
// Desired_Time strings (no offset) as local time in the guest's zone.
// This is approximate — DST boundaries can be off by 1h on the day of
// transition. Sanity gate (±4h past, +180d future) absorbs that drift.
const TZ_OFFSET_HOURS: Record<string, number> = {
  "America/New_York": -4, // EDT half the year, EST the other half
  "America/Chicago": -5,
  "America/Denver": -6,
  "America/Phoenix": -7,
  "America/Los_Angeles": -7,
  "America/Anchorage": -8,
  "Pacific/Honolulu": -10,
};

function parseDesiredTimeMs(
  raw: string,
  conversationTz: string | undefined,
): number | null {
  if (!raw) return null;
  // Has explicit offset (e.g. "2026-05-06T09:00:00-04:00") → JS parses correctly.
  if (/[+-]\d{2}:?\d{2}$|Z$/.test(raw)) {
    const ms = new Date(raw).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  // Naive timestamp — interpret in the convo's timezone if known,
  // otherwise treat as UTC (JS default).
  const ms = new Date(raw + "Z").getTime();
  if (!Number.isFinite(ms)) return null;
  const offsetHours = conversationTz
    ? (TZ_OFFSET_HOURS[conversationTz] ?? 0)
    : 0;
  // If raw is local time "09:00", we want UTC = local - offsetHours.
  // Date(raw + "Z") parsed it AS UTC, so adjust by -offsetHours.
  return ms - offsetHours * 3_600_000;
}

interface Hit {
  ihId: string;
  phone: string;
  oldEventTime: string;
  oldFiredBy: string;
  callId: string;
  desiredTime: string;
  desiredMs: number;
  nowMs: number;
}

console.log(`🔁 recover-bland-desired-time  APPLY=${APPLY}\n`);

const ih = await db.collection(IH).where("eventTimePlaceholder", "==", true)
  .get();
console.log(`📋 placeholder ih docs: ${ih.size}`);

const hits: Hit[] = [];
const rejected: Array<{ phone: string; reason: string }> = [];
const noConvo: string[] = [];
const noDesired: string[] = [];

for (const d of ih.docs) {
  const data = d.data() as Record<string, unknown>;
  const phone = String(data.phone ?? "");
  if (!phone) continue;

  let convos: { id: string; created_at?: string }[] = [];
  try {
    convos = await searchConversationsByPhone(phone);
  } catch (e) {
    rejected.push({ phone, reason: `search failed: ${(e as Error).message}` });
    continue;
  }
  if (!convos.length) {
    noConvo.push(phone);
    continue;
  }

  let chosen: Hit | null = null;
  for (const c of convos) {
    const r = await getConversation(c.id);
    // deno-lint-ignore no-explicit-any
    const cd: any = (r.json as any)?.data ?? {};
    const v = cd.variables ?? {};
    const dt = typeof v.Desired_Time === "string" ? v.Desired_Time : "";
    if (!dt) continue;
    const nowIso = typeof v.now_utc === "string" ? v.now_utc : cd.created_at;
    const nowMs = nowIso ? new Date(nowIso).getTime() : NaN;
    const tz = typeof v.timezone === "string" ? v.timezone : undefined;
    const desiredMs = parseDesiredTimeMs(dt, tz);
    if (desiredMs == null || !Number.isFinite(nowMs)) continue;
    // Sanity gate: appt must be no earlier than 4h before the convo's
    // now_utc (covers talk-now and "call me in 30 min" cases, plus DST
    // off-by-one), and no later than 180 days after (vacation bookings
    // can land months out). Anything outside is stale upstream data.
    if (desiredMs < nowMs - SANITY_PAST_TOLERANCE_MS) continue;
    if (desiredMs > nowMs + MAX_FUTURE_MS) continue;
    chosen = {
      ihId: d.id,
      phone,
      oldEventTime: String(data.eventTime ?? ""),
      oldFiredBy: String(data.firedBy ?? ""),
      callId: c.id,
      desiredTime: dt,
      desiredMs,
      nowMs,
    };
    break;
  }
  if (chosen) hits.push(chosen);
  else noDesired.push(phone);
}

console.log(`\n📊 results:`);
console.log(`   ✅ recovered Desired_Time (valid):     ${hits.length}`);
console.log(`   ❌ convo exists but no usable variable: ${noDesired.length}`);
console.log(`   ❌ no Bland convo found:                ${noConvo.length}`);
console.log(`   ❌ search/fetch errors:                 ${rejected.length}`);
console.log();
for (const h of hits) {
  const days = ((h.desiredMs - h.nowMs) / 86_400_000).toFixed(1);
  console.log(
    `  ✅ ${h.phone}  oldFiredBy=${h.oldFiredBy}  Desired_Time=${h.desiredTime}  (+${days}d from convo)`,
  );
}
if (noDesired.length) {
  console.log("\n  no usable variable:");
  for (const p of noDesired) console.log(`    - ${p}`);
}
if (noConvo.length) {
  console.log("\n  no Bland convo:");
  for (const p of noConvo) console.log(`    - ${p}`);
}

if (hits.length === 0) {
  console.log("\n✅ nothing to update.");
  Deno.exit(0);
}

if (!APPLY) {
  console.log("\n(DRY RUN — pass --apply to mutate)");
  Deno.exit(0);
}

console.log("\n🚧 applying…");
const updatedAt = new Date().toISOString();
const batch = db.batch();
for (const h of hits) {
  batch.update(db.doc(`${IH}/${h.ihId}`), {
    eventTime: h.desiredTime,
    eventTimePlaceholder: false,
    firedBy: "bland-variable-recovery",
    recoveredFromCallId: h.callId,
    recoveredEventTimeSource:
      `bland.variables.Desired_Time (was ${h.oldFiredBy})`,
    reclassifiedAt: updatedAt,
    reclassifiedReason:
      "Pulled the canonical Desired_Time from Bland's request variables — the bot had already parsed the appointment time, we just hadn't read it.",
  });
  // Update the matching guestactivated doc too: clear placeholder + use
  // the real Bland-confirmed eventTime so the dashboard shows the right
  // scheduled call time.
  const gaRef = db.doc(`${GA}/${h.phone}`);
  const gaSnap = await gaRef.get();
  if (gaSnap.exists) {
    const ga = gaSnap.data() ?? {};
    // Only patch guestactivated rows that were sourced from the same
    // placeholder ih (eventTime matched). Don't clobber rows whose ga
    // was already pointing somewhere else.
    if (ga.eventTime === h.oldEventTime || ga.eventTimePlaceholder === true) {
      batch.update(gaRef, {
        eventTime: h.desiredTime,
        eventTimePlaceholder: false,
      });
    }
  }
}
await batch.commit();
console.log(`\n✅ recovered ${hits.length} ih docs from Bland Desired_Time.`);
Deno.exit(0);
