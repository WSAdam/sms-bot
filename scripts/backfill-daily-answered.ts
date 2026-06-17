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
// The CURRENT ET day is deliberately skipped for the per-day merge: it's owned
// by the live forward counter in importDailyDispositions, which sees real-time
// increments. Overwriting it with a mid-day snapshot would transiently
// undercount today's answers. Lifetime is a single all-time total and still
// includes today (see the note at the lifetime write).
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
import {
  type FirestoreClient,
  getFirestoreClient,
  type ListResult,
} from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";

// Parse a Firestore timestamp value (ISO string or epoch ms) into its ET day
// (YYYY-MM-DD), or null if it isn't a usable date. The only nontrivial pure
// logic in this script — unit-tested in tests/unit/scripts/.
export function bucketDay(iso: unknown): string | null {
  if (typeof iso === "string") {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) return easternDateString(new Date(ms));
  }
  if (typeof iso === "number" && Number.isFinite(iso)) {
    return easternDateString(new Date(iso));
  }
  return null;
}

export interface BackfillResult {
  answeredByDay: Map<string, number>;
  lifetime: number;
  skippedExcluded: number;
  skippedNoDate: number;
  daysWritten: number;
}

// Tally guestanswered docs by ET day and (unless dryRun) merge the per-day +
// lifetime `answered` counters. `today` is injectable for deterministic tests;
// it defaults to the current ET day and is excluded from the per-day merge.
export async function runBackfill(
  db: FirestoreClient,
  answered: ListResult[],
  opts: { dryRun?: boolean; today?: string } = {},
): Promise<BackfillResult> {
  const today = opts.today ?? easternDateString(new Date());

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

  if (opts.dryRun) {
    return {
      answeredByDay,
      lifetime,
      skippedExcluded,
      skippedNoDate,
      daysWritten: 0,
    };
  }

  // setMerge (not set/batch) so we only touch `answered` and leave the other
  // daily counters intact. Skip the current ET day — the live counter owns it.
  const updatedAt = new Date().toISOString();
  const days = [...answeredByDay.entries()].filter(([day]) => day !== today);
  const CHUNK = 50;
  for (let i = 0; i < days.length; i += CHUNK) {
    await Promise.all(
      days.slice(i, i + CHUNK).map(([day, n]) =>
        db.setMerge(metricsDailyDocPath(day), { answered: n, updatedAt })
      ),
    );
  }
  // Lifetime is the all-time total (includes today). This overwrites the live
  // value with the canonical recompute — correct because the live counter only
  // accrues forward and undercounts pre-counter phones. Run when the dialer /
  // import isn't actively writing, so the read-snapshot doesn't lose
  // increments landing between the list() and this write.
  await db.setMerge(metricsLifetimeDocPath(), {
    answered: lifetime,
    updatedAt,
  });

  return {
    answeredByDay,
    lifetime,
    skippedExcluded,
    skippedNoDate,
    daysWritten: days.length,
  };
}

if (import.meta.main) {
  const args = parseArgs(Deno.args, { boolean: ["dry-run"] });
  const dryRun = !!args["dry-run"];
  const db = getFirestoreClient();

  console.log(
    `🚀 backfill-daily-answered: scanning guestanswered (dryRun=${dryRun})`,
  );
  const answered = await db.list(guestAnsweredCollection, { limit: 200_000 });
  console.log(`🔍 fetched guestanswered=${answered.length}`);

  const r = await runBackfill(db, answered, { dryRun });
  console.log(
    `📊 lifetime answered=${r.lifetime} (skippedExcluded=${r.skippedExcluded} ` +
      `skippedNoDate=${r.skippedNoDate})`,
  );
  console.log(
    `📅 days with answered activity: ${r.answeredByDay.size} ` +
      `(today excluded from merge)`,
  );

  if (dryRun) {
    console.log(`📋 [dry-run] no writes.`);
  } else {
    console.log(
      `✅ done — merged answered into ${r.daysWritten} daily docs + lifetime`,
    );
  }
}
