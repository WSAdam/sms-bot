// Daily QB sale-match cron logic. Pulls today's bookings from the public
// Quickbase Cloud Function and matches each phone against scheduled-injection
// records, writing saleswithin7d markers for matches.
//
// Called from:
//   1. Deno.cron (main.ts) — once a day on Deploy
//   2. routes/api/guests/activate-from-report — manual trigger from the Test page

import {
  QUICKBASE_BOOKINGS_REPORT_ID,
  QUICKBASE_BOOKINGS_TABLE_ID,
} from "@shared/config/constants.ts";
import { getQuickbaseClient } from "@shared/services/quickbase/client.ts";
import { normalizeBookingRows } from "@shared/services/quickbase/report.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";
import type { ActivateFromReportSummary } from "@shared/types/sale.ts";

export interface DailyCronResult {
  ok: boolean;
  reason?: string;
  summary?: ActivateFromReportSummary;
}

export async function runDailyQbSaleMatch(
  reportId: string = QUICKBASE_BOOKINGS_REPORT_ID,
  tableId: string = QUICKBASE_BOOKINGS_TABLE_ID,
): Promise<DailyCronResult> {
  console.log(
    `[sale-match] starting: tableId=${tableId} reportId=${reportId}`,
  );
  let report;
  try {
    report = await getQuickbaseClient().getReport(tableId, reportId);
  } catch (e) {
    console.error(`[sale-match] ❌ QB fetch failed: ${(e as Error).message}`);
    return { ok: false, reason: `Quickbase fetch failed: ${(e as Error).message}` };
  }
  const rawCount = report.data?.length ?? 0;
  console.log(
    `[sale-match] QB returned ${rawCount} raw rows, fields=${
      (report.fields ?? []).map((f) => `${f.id}:${f.label}`).join(",") || "(none)"
    }`,
  );
  const rows = normalizeBookingRows(report);
  console.log(
    `[sale-match] normalized to ${rows.length} usable phones (dropped ${rawCount - rows.length})`,
  );
  if (rows.length > 0) {
    const sample = rows.slice(0, 3).map((r) =>
      `${r.phone10}${r.addedDate ? "@" + r.addedDate : ""}`
    );
    console.log(`[sale-match] sample rows: ${sample.join(", ")}`);
  }
  // If the report exposes a per-row activation date (field -1 in the legacy
  // bookings report shape), pass it as saleAt so the 7-day window is measured
  // against the actual activation date instead of "now". Lets us replay
  // historical activations against historical scheduled-injection records.
  const summary = await processSaleMatches(
    rows.map((r) => ({
      phone10: r.phone10,
      ...(r.addedDate ? { saleAt: r.addedDate } : {}),
    })),
  );
  console.log(
    `[sale-match] done: matched=${summary.matched} ` +
      `skippedNoInjection=${summary.skippedNoInjection} ` +
      `skippedOlderThan7Days=${summary.skippedOlderThan7Days}`,
  );
  return { ok: true, summary };
}
