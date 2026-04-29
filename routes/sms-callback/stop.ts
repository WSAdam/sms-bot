// STOP / opt-out handling. Marks DNC in Firestore, writes a STOP message
// into conversations (so dashboards reflect the opt-out), and DNCs the lead
// in every ReadyMode domain.

import { define } from "@/utils.ts";
import { storeMessage } from "@shared/services/conversations/store.ts";
import { markDnc } from "@shared/services/dnc/service.ts";
import { dncGlobal } from "@shared/services/readymode/service.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as { phone?: string } | null;
    if (!body?.phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const phone = normalizePhone(body.phone);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

    await storeMessage(phone, "DNC_REQUEST", "Guest", "STOP / Opt-out", "STOP", true);
    await markDnc(phone, "STOP");

    let dncResults: Record<string, string> = {};
    try {
      dncResults = await dncGlobal(phone);
    } catch (e) {
      console.warn(`[stop] dncGlobal failed (non-fatal): ${(e as Error).message}`);
    }

    return Response.json({ status: "success", phone, dnc: dncResults });
  },
});
