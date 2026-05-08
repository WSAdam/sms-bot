// Manual trigger for the per-phone Bland conversation pull. Used to
// recover conversations that fell outside the nightly reseed's 1-day
// window (e.g. sales activated days/weeks after the original Bland call).
//
// POST body: { phone10: string } | { phone: string }
// Response: PerPhonePullSummary

import { define } from "@/utils.ts";
import { reseedConversationsForPhone } from "@shared/services/conversations/reseed.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone10?: string; phone?: string }
      | null;
    const raw = body?.phone10 ?? body?.phone ?? "";
    const phone10 = normalizePhone(raw);
    if (!phone10) {
      return Response.json({ error: "Missing or invalid phone" }, {
        status: 400,
      });
    }
    try {
      const summary = await reseedConversationsForPhone(phone10);
      return Response.json({ success: true, ...summary });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[pull-conversations] ❌ ${phone10}: ${msg}`);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  },
});
