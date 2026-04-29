// DELETE /sms-callback/conversation-history → wipe all conversation messages
// for a phone number. Used as a debug/reset.

import { define } from "@/utils.ts";
import { deleteConversations } from "@shared/services/conversations/store.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const body = await ctx.req.json().catch(() => null) as { phone?: string } | null;
    if (!body?.phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const phone = normalizePhone(body.phone);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });
    const deleted = await deleteConversations(phone);
    return Response.json({ status: "success", phone, deleted });
  },
});
