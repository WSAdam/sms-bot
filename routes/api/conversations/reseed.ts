// Manual trigger for the conversation reseed flow that the nightly cron
// also calls. Defaults to yesterday-in-ET if no body provided; supports
// `{ days: N }` to reseed the last N full ET days, or
// `{ fromIso, toIso }` for an explicit window.

import { define } from "@/utils.ts";
import {
  reseedConversationsByDateRange,
  yesterdayEasternRange,
} from "@shared/services/conversations/reseed.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { days?: number; fromIso?: string; toIso?: string }
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

    const summary = await reseedConversationsByDateRange(fromIso, toIso);
    return Response.json({ success: true, ...summary });
  },
});
