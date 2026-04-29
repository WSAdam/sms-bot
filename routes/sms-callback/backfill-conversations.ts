// Bulk backfill: given Bland conversation IDs, fetch each from Bland, find
// the first AGENT message, and store it in conversations. Used to populate
// history for conversations that happened before initial-message storage was
// implemented.

import { define } from "@/utils.ts";
import * as bland from "@shared/services/bland/client.ts";
import { storeMessage } from "@shared/services/conversations/store.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { conversationIds?: string[] }
      | null;
    const ids = body?.conversationIds ?? [];
    if (!ids.length) return Response.json({ error: "conversationIds required" }, { status: 400 });

    const results: Record<string, string> = {};
    for (const conversationId of ids) {
      try {
        const r = await bland.getConversation(conversationId);
        const phone = r.json.data?.user_number ?? "";
        const messages = r.json.data?.messages ?? [];
        const first = messages.find((m) => m.sender === "AGENT");

        if (!phone) {
          results[conversationId] = "error: no user_number in response";
          continue;
        }
        if (!first) {
          results[conversationId] = "skipped: no AGENT message found";
          continue;
        }
        const phone10 = phone.replace(/\D/g, "").slice(-10);
        await storeMessage(phone10, conversationId, "AI Bot", first.message);
        results[conversationId] = `stored: "${first.message.slice(0, 60)}…"`;
      } catch (e) {
        results[conversationId] = `error: ${(e as Error).message}`;
      }
    }

    return Response.json({ status: "success", processed: ids.length, results });
  },
});
