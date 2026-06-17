// One-shot backfill: seed sms-bot/metrics/daily/*.answered and
// metrics/lifetime/totals.answered from the existing guestanswered collection,
// so the nightly report's "calls answered" number is correct for historical
// days (the write-side counter in import-dispositions.ts only accrues forward
// from its deploy).
//
// Source of truth: guestanswered/byPhone — one doc per phone whose dialer call
// connected, with `answeredAt` = the earliest answered call time. Every doc in
// there is already in-funnel (the import gates on answered ⊆ booked before
// writing), so we only drop the excluded test phones (same as the dashboard's
// answeredCount). We bucket each phone by the ET day of its answeredAt.
//
// Idempotent + non-destructive: each daily doc's `answered` field is written
// with setMerge (NOT a full set), so the sibling counters (textsSent,
// apptsBooked, activations) written by backfill-daily-metrics.ts and the live
// write sites are preserved. The value is the recomputed canonical count, so
// re-running converges rather than accumulates. Safe to re-run any time.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//   deno run -A --env-file=env/local scripts/backfill-daily-answered.ts \
//     [--dry-run]

import { parseArgs } from "@std/cli/parse-args";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  guestAnsweredCollection,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";

const args = parseArgs(Deno.args, { boolean: ["dry-run"] });
const dryRun = !!args["dry-run"];

const db = getFirestoreClient();

console.log(
  `🚀 backfill-daily-answered: scanning guestanswered (dryRun=${dryRun})`,
);

const answered = await db.list(guestAnsweredCollection, { limit: 200_000 });
console.log(`🔍 fetched guestanswered=${answered.length}`);

function bucketDay(iso: unknown): string | null {
  if (typeof iso === "string") {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) return easternDateString(new Date(ms));
  }
  if (typeof iso === "number" && Number.isFinite(iso)) {
    return easternDateString(new Date(iso));
  }
  return null;
}

const answeredByDay = new Map<string, number>();
let skippedExcluded = 0;
let skippedNoDate = 0;

for (const e of answered) {
  const d = e.data as Record<string, unknown>;
  const phone10 = String(d.phone10 ?? e.id);
  if (isExcludedFromReporting(phone10)) {
    skippedExcluded++;
    continue;
  }
  const day = bucketDay(d.answeredAt);
  if (!day) {
    skippedNoDate++;
    continue;
  }
  answeredByDay.set(day, (answeredByDay.get(day) ?? 0) + 1);
}

let lifetime = 0;
for (const n of answeredByDay.values()) lifetime += n;

console.log(
  `📊 lifetime answered=${lifetime} (skippedExcluded=${skippedExcluded} ` +
    `skippedNoDate=${skippedNoDate})`,
);
console.log(`📅 days with answered activity: ${answeredByDay.size}`);

if (dryRun) {
  console.log(`📋 [dry-run] no writes.`);
  Deno.exit(0);
}

// setMerge (not set/batch) so we only touch the `answered` field and leave the
// other daily counters intact. Chunk the per-day writes so we never fan out an
// unbounded Promise.all.
const updatedAt = new Date().toISOString();
const days = [...answeredByDay.entries()];
const CHUNK = 50;
for (let i = 0; i < days.length; i += CHUNK) {
  await Promise.all(
    days.slice(i, i + CHUNK).map(([day, n]) =>
      db.setMerge(metricsDailyDocPath(day), { answered: n, updatedAt })
    ),
  );
}
await db.setMerge(metricsLifetimeDocPath(), { answered: lifetime, updatedAt });

console.log(
  `✅ done — merged answered into ${answeredByDay.size} daily docs + lifetime`,
);
