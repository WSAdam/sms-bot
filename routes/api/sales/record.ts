// Single-phone manual sale match. Wraps the same processSaleMatches helper
// the daily cron uses but for one input.

import { define } from "@/utils.ts";
import { processSaleMatches } from "@shared/services/sale-match/service.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; saleAt?: string }
      | null;
    if (!body?.phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const phone10 = normalizePhone(body.phone);
    if (!phone10) return Response.json({ error: "Invalid phone" }, { status: 400 });
    const r = await processSaleMatches([{ phone10, saleAt: body.saleAt }]);
    return Response.json(r);
  },
});
