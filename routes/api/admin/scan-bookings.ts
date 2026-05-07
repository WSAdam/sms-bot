// Manual trigger for the booking-scan flow that the nightly cron also runs.
// Body shape:
//   { dryRun?: boolean, days?: number, fromIso?: string, toIso?: string }
//
// Default window: yesterday in ET (matches the nightly cron). Pass `days: N`
// to scan the last N days; `dryRun: true` returns proposals without writing.

import { define } from "@/utils.ts";
import {
  scanConversationsForBookings,
  yesterdayEasternRange,
} from "@shared/services/conversations/booking-scan.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | {
        dryRun?: boolean;
        force?: boolean;
        days?: number;
        fromIso?: string;
        toIso?: string;
      }
      | null;

    let fromIso: string;
    let toIso: string | undefined;
    if (body?.fromIso) {
      fromIso = body.fromIso;
      toIso = body.toIso;
    } else if (typeof body?.days === "number" && body.days > 0) {
      const ms = body.days * 24 * 60 * 60 * 1000;
      fromIso = new Date(Date.now() - ms).toISOString();
    } else {
      const r = yesterdayEasternRange();
      fromIso = r.fromIso;
      toIso = r.toIso;
    }

    const apply = body?.dryRun !== true;
    const force = body?.force === true;
    const summary = await scanConversationsForBookings(
      fromIso,
      toIso,
      apply,
      force,
    );
    return Response.json({ success: true, dryRun: !apply, force, ...summary });
  },
});
