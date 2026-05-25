// Returns the last-run marker for every Deno.cron job, so Adam can
// glance at /test and immediately see whether anything's silently
// broken. Each marker is updated at the end of every cron tick by
// `recordCronRun` in shared/services/cron-health/marker.ts.
//
// Adds an "agedHours" annotation to each marker so the test page can
// render "ran 16h ago" / "stale: last ran 18d ago" without doing the
// math client-side.

import { define } from "@/utils.ts";
import { metricsCronRunDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

// Each cron's expected freshness in hours. If `agedHours` exceeds the
// threshold, the response marks the cron as "stale" — that's the
// signal that Adam should investigate.
const CRON_FRESHNESS_HOURS: Record<string, number> = {
  "scheduled-injection-sweep-v2": 0.05, // 3 minutes — runs every minute
  "nightly-conversation-reseed": 26,
  "daily-qb-sale-match": 26,
  "nightly-report": 26,
  "readymode-daily-pull": 26,
  "metrics-kvbreakdown-refresh": 26,
};

interface CronRunMarker {
  lastRunAt?: string;
  lastStatus?: "ok" | "error";
  lastDurationMs?: number;
  lastError?: string;
}

interface CronStatus extends CronRunMarker {
  name: string;
  agedHours: number | null;
  stale: boolean;
  expectedFreshnessHours: number;
}

export const handler = define.handlers({
  async GET() {
    const db = getFirestoreClient();
    const names = Object.keys(CRON_FRESHNESS_HOURS);
    const markers = await Promise.all(
      names.map((name) => db.get(metricsCronRunDocPath(name))),
    );
    const now = Date.now();
    const crons: CronStatus[] = names.map((name, idx) => {
      const m = (markers[idx] ?? {}) as CronRunMarker;
      const lastRunMs = m.lastRunAt ? new Date(m.lastRunAt).getTime() : NaN;
      const agedHours = Number.isFinite(lastRunMs)
        ? (now - lastRunMs) / 3_600_000
        : null;
      const expected = CRON_FRESHNESS_HOURS[name];
      const stale = agedHours === null || agedHours > expected;
      return {
        name,
        lastRunAt: m.lastRunAt,
        lastStatus: m.lastStatus,
        lastDurationMs: m.lastDurationMs,
        lastError: m.lastError,
        agedHours: agedHours === null ? null : Math.round(agedHours * 10) / 10,
        stale,
        expectedFreshnessHours: expected,
      };
    });
    const anyStale = crons.some((c) => c.stale);
    const anyErrored = crons.some((c) => c.lastStatus === "error");
    return Response.json({
      ok: !anyStale && !anyErrored,
      anyStale,
      anyErrored,
      crons,
    }, { headers: { "Cache-Control": "no-store" } });
  },
});
