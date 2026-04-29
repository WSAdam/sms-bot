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

export async function runDailyQbSaleMatch(): Promise<DailyCronResult> {
  let report;
  try {
    report = await getQuickbaseClient().getReport(
      QUICKBASE_BOOKINGS_TABLE_ID,
      QUICKBASE_BOOKINGS_REPORT_ID,
    );
  } catch (e) {
    return { ok: false, reason: `Quickbase fetch failed: ${(e as Error).message}` };
  }
  const rows = normalizeBookingRows(report);
  const summary = await processSaleMatches(rows.map((r) => ({ phone10: r.phone10 })));
  return { ok: true, summary };
}
