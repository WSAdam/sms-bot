// Legacy by-phone conversation search.

import { define } from "@/utils.ts";
import { getAllConversations } from "@shared/services/conversations/store.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const phone = url.searchParams.get("phone") ?? "";
    if (!phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const messages = await getAllConversations(phone);
    return Response.json({ phone, count: messages.length, messages });
  },
});
