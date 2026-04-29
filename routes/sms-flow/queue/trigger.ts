// External KV cron used to POST here when a scheduled appointment time was
// reached. The body is `{type: "INJECT_APPT", phone}`. We fire-and-forget the
// delayed injection handler and return immediately so the caller doesn't time
// out.

import { define } from "@/utils.ts";
import { handleDelayedInjection } from "@shared/services/orchestrator/queue.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { type?: string; phone?: string }
      | null;
    if (body?.type !== "INJECT_APPT" || !body?.phone) {
      return Response.json({ success: false, error: "Invalid message format" }, { status: 400 });
    }
    const phone = normalizePhone(body.phone);
    if (!phone) return Response.json({ success: false, error: "Invalid phone" }, { status: 400 });

    handleDelayedInjection(phone).catch((e) => {
      console.error(`[queue/trigger] async handler error: ${(e as Error).message}`);
    });
    return Response.json({ success: true, phone, message: "Processing started" });
  },
});
