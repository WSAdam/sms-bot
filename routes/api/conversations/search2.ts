// Filtered by-phone search. Supports optional callId / sender / nodeTag /
// "contains" filters and a limit.

import { define } from "@/utils.ts";
import { getAllConversations } from "@shared/services/conversations/store.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const phone = url.searchParams.get("phone") ?? "";
    const callId = url.searchParams.get("callId");
    const sender = url.searchParams.get("sender");
    const nodeTag = url.searchParams.get("nodeTag");
    const contains = url.searchParams.get("contains");
    const limit = Number(url.searchParams.get("limit") ?? 200);

    if (!phone) return Response.json({ error: "Missing phone" }, { status: 400 });

    const all = await getAllConversations(phone);
    const filtered = all.filter((m) => {
      if (callId && m.callId !== callId) return false;
      if (sender && m.sender.toLowerCase() !== sender.toLowerCase()) return false;
      if (nodeTag && (m.nodeTag ?? "").toLowerCase() !== nodeTag.toLowerCase()) {
        return false;
      }
      if (contains && !m.message.toLowerCase().includes(contains.toLowerCase())) {
        return false;
      }
      return true;
    }).slice(0, limit);

    return Response.json({ phone, count: filtered.length, messages: filtered });
  },
});
