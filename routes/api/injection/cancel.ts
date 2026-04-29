import { define } from "@/utils.ts";
import { cancelScheduledInjection } from "@shared/services/injections/schedule.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const url = new URL(ctx.req.url);
    const phone = url.searchParams.get("phone");
    if (!phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const ok = await cancelScheduledInjection(phone);
    return Response.json({ success: ok, phone });
  },
});
