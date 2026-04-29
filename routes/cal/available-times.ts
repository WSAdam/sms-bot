// POST /cal/available-times
//
// Returns synthetic 15-min slots, 9am–5pm ET, future-only. Default range is
// now+30min → now+7d. Cal.com availability is NOT consulted — overbooking is
// allowed by design (matches legacy CalController behavior).

import { define } from "@/utils.ts";
import * as cal from "@shared/services/cal/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { startTime?: string; endTime?: string }
      | null;

    const slots = cal.getAvailableTimes(body?.startTime, body?.endTime);
    return Response.json({
      slots,
      message: "Generated slots — overbooking is allowed",
    });
  },
});
