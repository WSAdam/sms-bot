// One-shot: backfill Bland transcripts for historical talk-now leads.
//
// Talk-now bookings (POST /sms-callback/bland/talk-now) injected + wrote an
// injectionhistory doc but never stored the conversation — the "I want to talk
// now" exchange lives in Bland. The forward fix (ingestBlandTranscript wired
// into the webhook) only helps NEW leads; this pulls the transcripts for the
// historical ones (e.g. 8508306131). See context.md §0.21.
//
// ADDITIVE + idempotent + non-destructive: ingestBlandTranscript only `set`s
// each message (never deletes), so re-running is safe, existing docs and the
// "appointment scheduled" marker are preserved, and partial runs can be
// resumed by just running again.
//
// Touches Bland (read) + Firestore (write). NO ReadyMode, NO dialer — so the
// ≤1 RM-call/min cap does not apply here.
//
// Dry run (default — lists the target phones, writes nothing):
//   deno run -A --env-file=env/local scripts/backfill-talk-now-transcripts.ts
// Apply:
//   deno run -A --env-file=env/local scripts/backfill-talk-now-transcripts.ts --apply

import { injectionHistoryCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { ingestBlandTranscript } from "@shared/services/conversations/reseed.ts";
import { normalizePhone } from "@shared/util/phone.ts";

const APPLY = Deno.args.includes("--apply");
const PARALLEL = 4; // mirror the nightly reseed — gentle on Bland's API.

const db = getFirestoreClient();

// injectionhistory is small (~hundreds of docs); read it all once and filter
// in memory so we don't depend on a `firedBy` index existing.
const rows = await db.list(injectionHistoryCollection, { limit: 10_000 });
const phones = new Set<string>();
for (const r of rows) {
  const d = r.data as Record<string, unknown>;
  if (d.firedBy !== "talk-now") continue;
  const p = normalizePhone(typeof d.phone === "string" ? d.phone : "");
  if (p) phones.add(p);
}
const list = [...phones].sort();

console.log(`🔍 injectionhistory docs scanned: ${rows.length}`);
console.log(`📞 distinct talk-now phones: ${list.length}`);

if (!APPLY) {
  console.log(
    "\n--- DRY RUN (no writes) — phones that would be backfilled ---",
  );
  for (const p of list) console.log("  " + p);
  console.log(
    `\nRun with --apply to pull + store transcripts for ${list.length} phones.`,
  );
  Deno.exit(0);
}

console.log(
  `\n🚀 APPLY: pulling Bland transcripts for ${list.length} phones (parallel ${PARALLEL})…`,
);
let stored = 0;
let errored = 0;
let conversations = 0;
let phonesWithMessages = 0;
const errors: string[] = [];
for (let i = 0; i < list.length; i += PARALLEL) {
  const chunk = list.slice(i, i + PARALLEL);
  const results = await Promise.all(chunk.map((p) => ingestBlandTranscript(p)));
  for (const s of results) {
    stored += s.stored;
    errored += s.errored;
    conversations += s.conversations;
    if (s.stored > 0) phonesWithMessages++;
    for (const e of s.errors) errors.push(`${s.phone10}: ${e}`);
  }
  console.log(
    `  …${Math.min(i + PARALLEL, list.length)}/${list.length} phones`,
  );
}
console.log(
  `\n✅ done — phones=${list.length} phonesWithMessages=${phonesWithMessages} conversations=${conversations} messagesStored=${stored} errored=${errored}`,
);
if (errors.length) {
  console.log(`⚠️ ${errors.length} per-conversation errors (first 50):`);
  for (const e of errors.slice(0, 50)) console.log("  " + e);
}
