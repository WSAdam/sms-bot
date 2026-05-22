// One-shot seed for `metrics/kvBreakdown/totals` — the per-container
// row-count doc the dashboard reads to render its kvBreakdown sidebar.
//
// Run this once after deploying the new dashboard stats.ts so the
// counter doc exists from day one. Going forward, the daily
// `metrics-kvbreakdown-refresh` cron at 06:00 UTC re-counts every
// container and overwrites the doc — so drift from missed write-site
// increments is bounded to 24 hours.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//     deno run -A --env-file=env/local scripts/backfill-kv-counters.ts
//
// Idempotent — re-runs always overwrite.

import { refreshKvBreakdown } from "@shared/services/cron-health/kv-breakdown.ts";

console.log("🚀 backfill-kv-counters: counting every container...");

const r = await refreshKvBreakdown();
console.log(
  `✅ done — total=${r.total} duration=${r.durationMs}ms`,
);
console.log("📊 per-container counts:");
for (const [key, n] of Object.entries(r.counts).sort((a, b) => b[1] - a[1])) {
  console.log(`   ${key.padEnd(24)} ${String(n).padStart(7)}`);
}
