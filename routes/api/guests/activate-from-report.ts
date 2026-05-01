// Manual trigger for the daily QB sale-match cron. The same logic also runs
// automatically on Deno Deploy via Deno.cron (see main.ts) — this route is
// just for manual firing from the Test page or curl.

import { define } from "@/utils.ts";
import { runDailyQbSaleMatch } from "@shared/services/sale-match/cron.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { reportId?: string; tableId?: string }
      | null;
    const r = await runDailyQbSaleMatch(body?.reportId, body?.tableId);
    if (!r.ok) {
      return Response.json(
        { success: false, reason: r.reason },
        { status: 502 },
      );
    }
    return Response.json(r.summary);
  },
});
