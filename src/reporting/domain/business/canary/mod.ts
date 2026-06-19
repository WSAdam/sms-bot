// Gathers yesterday's "hard-break" errors for the Canary errors endpoint.
//
// A hard-break error = a persisted terminal failure (one that wasn't solved
// by a retry). Two sources, both already written to Firestore:
//
//   1. injectionhistory status="error" — the scheduled-injection sweep only
//      records "error" when handleDelayedInjection throws, which happens after
//      injectLead/handleDuplicate has exhausted its one retry. A retry that
//      succeeds never lands here.
//   2. metrics/cronruns lastStatus="error" — a whole cron handler threw
//      (the heartbeat marker that surfaced the 16-day silent sale-match
//      failure). An unhandled cron exception is almost always a real bug.
//
// Known gap: inbound Bland-SMS send failures and ad-hoc direct injects are
// console-only today, so they don't appear here. See the plan's "Coverage
// gap & optional v2".

import {
  injectionHistoryCollection,
  metricsCronRunsCollection,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { yesterdayEasternRange } from "@shared/services/conversations/booking-scan.ts";
import { easternDateString } from "@shared/util/time.ts";
import type { InjectionHistoryEntry } from "@shared/types/injection.ts";
import type { CronRunMarker } from "@shared/services/cron-health/marker.ts";

export interface CanaryError {
  source: "injection" | "cron";
  error: string;
  ts: string; // ISO timestamp of when it happened
  phone?: string;
  step?: string;
  firedBy?: string;
  cron?: string;
}

export interface HardErrorsReport {
  date: string; // yesterday, YYYY-MM-DD ET
  window: { since: string; until: string };
  totalErrors: number;
  errors: CanaryError[];
}

// Equality query on `status` returns ONLY error docs (errors are rare), so
// this stays well under the list() anti-scan tripwire — no firedAt range
// scan, no composite index needed. We bound the window in memory.
const INJECTION_ERROR_LIMIT = 500;
const CRON_MARKER_LIMIT = 100;

function inWindow(ts: string, fromIso: string, toIso: string): boolean {
  return ts >= fromIso && ts < toIso;
}

export async function gatherHardErrorsForYesterday(
  client: FirestoreClient = getFirestoreClient(),
): Promise<HardErrorsReport> {
  const { fromIso, toIso } = yesterdayEasternRange();
  const date = easternDateString(new Date(Date.now() - 86_400_000));

  const [injectionDocs, cronDocs] = await Promise.all([
    client.list(injectionHistoryCollection, {
      where: { field: "status", op: "==", value: "error" },
      limit: INJECTION_ERROR_LIMIT,
    }),
    client.list(metricsCronRunsCollection, { limit: CRON_MARKER_LIMIT }),
  ]);

  const errors: CanaryError[] = [];

  for (const d of injectionDocs) {
    const e = d.data as unknown as InjectionHistoryEntry;
    if (typeof e.firedAt !== "string" || !inWindow(e.firedAt, fromIso, toIso)) {
      continue;
    }
    errors.push({
      source: "injection",
      error: e.error ?? "(no message)",
      ts: e.firedAt,
      phone: e.phone,
      step: "scheduled-injection",
      firedBy: e.firedBy,
    });
  }

  for (const d of cronDocs) {
    const m = d.data as unknown as CronRunMarker;
    if (m.lastStatus !== "error") continue;
    if (
      typeof m.lastRunAt !== "string" || !inWindow(m.lastRunAt, fromIso, toIso)
    ) {
      continue;
    }
    errors.push({
      source: "cron",
      error: m.lastError ?? "(no message)",
      ts: m.lastRunAt,
      cron: d.id,
      step: "cron-run",
    });
  }

  // Newest first, so the bug-fixing workflow sees the most recent failures up top.
  errors.sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0));

  return {
    date,
    window: { since: fromIso, until: toIso },
    totalErrors: errors.length,
    errors,
  };
}
