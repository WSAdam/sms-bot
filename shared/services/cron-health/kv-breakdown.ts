// Per-container row-count snapshot used by the dashboard's kvBreakdown
// sidebar. Pre-refactor the dashboard scanned 10 collections at
// limit:50_000 each on every page load to compute these counts. Now:
// a single doc at metrics/kvBreakdown/totals carries one numeric
// field per container; the dashboard reads it once, fast.
//
// `refreshKvBreakdown()` (this file) re-counts every container once
// and overwrites the doc. Called by:
//   - scripts/backfill-kv-counters.ts — one-shot seed
//   - The daily `metrics-kvbreakdown-refresh` cron in main.ts —
//     overwrites the doc once per day so drift from missed write-site
//     increments is bounded to 24 hours.
//
// Lists are bulk reads (limit 100_000) since they happen exactly once
// per day. Total daily cost: ~50k reads, comparable to one old
// dashboard page-load.

import {
  auditCollection,
  conversationsCollection,
  guestActivatedCollection,
  guestAnsweredCollection,
  injectionHistoryCollection,
  leadPointerCollection,
  metricsKvBreakdownDocPath,
  salesOutsideWindowCollection,
  salesWithin7dCollection,
  scheduledInjectionsCollection,
  smsFlowContextCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

// Map of container key → collection path. Container key is the
// dashboard's display name and the field name on the breakdown doc.
const CONTAINER_PATHS: Record<string, string> = {
  conversations: conversationsCollection,
  scheduledinjections: scheduledInjectionsCollection,
  smsflowcontext: smsFlowContextCollection,
  guestactivated: guestActivatedCollection,
  guestanswered: guestAnsweredCollection,
  audit: auditCollection,
  saleswithin7d: salesWithin7dCollection,
  salesoutsidewindow: salesOutsideWindowCollection,
  injectionhistory: injectionHistoryCollection,
  leadpointer: leadPointerCollection,
};

export interface KvBreakdownResult {
  counts: Record<string, number>;
  total: number;
  durationMs: number;
}

export async function refreshKvBreakdown(): Promise<KvBreakdownResult> {
  const db = getFirestoreClient();
  const t0 = performance.now();

  // Bulk lists in parallel. Each is bounded by collection size; the
  // tripwire in wrapper.list() will fire for the big ones (conversations
  // ~10k, audit ~37k) — these are the SOURCE of the rail's noise so
  // we accept it here (the alternative is the dashboard hitting these
  // 10× more often). Run this only via the daily cron or backfill.
  const entries = Object.entries(CONTAINER_PATHS);
  const lists = await Promise.all(
    entries.map(([, path]) => db.list(path, { limit: 100_000 })),
  );

  const counts: Record<string, number> = {};
  let total = 0;
  entries.forEach(([key], idx) => {
    const n = lists[idx].length;
    counts[key] = n;
    total += n;
  });

  await db.set(metricsKvBreakdownDocPath(), {
    ...counts,
    updatedAt: new Date().toISOString(),
  });

  const durationMs = Math.round(performance.now() - t0);
  return { counts, total, durationMs };
}
