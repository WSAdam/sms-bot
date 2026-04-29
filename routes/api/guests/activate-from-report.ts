// Daily sale-match cron entry point. External cron site posts here once per
// day with X-Cron-Secret. We pull the bookings report from Quickbase, then
// for every phone in it look up the scheduled injection and mark a sale if
// the booking is within 7 days of the appointment.

import { define } from "@/utils.ts";
import {
  QUICKBASE_BOOKINGS_REPORT_ID,
  QUICKBASE_BOOKINGS_TABLE_ID,
} from "@shared/config/constants.ts";
import { loadEnv } from "@shared/config/env.ts";
import { getQuickbaseClient } from "@shared/services/quickbase/client.ts";
import { normalizeBookingRows } from "@shared/services/quickbase/report.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const env = loadEnv();
    const secret = ctx.req.headers.get("X-Cron-Secret");
    if (env.cronSharedSecret && secret !== env.cronSharedSecret) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }

    let report;
    try {
      report = await getQuickbaseClient().getReport(
        QUICKBASE_BOOKINGS_TABLE_ID,
        QUICKBASE_BOOKINGS_REPORT_ID,
      );
    } catch (e) {
      return Response.json(
        { success: false, reason: `Quickbase fetch failed: ${(e as Error).message}` },
        { status: 502 },
      );
    }

    const rows = normalizeBookingRows(report);
    const summary = await processSaleMatches(
      rows.map((r) => ({ phone10: r.phone10 })),
    );
    return Response.json(summary);
  },
});
