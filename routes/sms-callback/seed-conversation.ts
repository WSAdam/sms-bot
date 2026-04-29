// Single-conversation seed.

import { define } from "@/utils.ts";
import * as bland from "@shared/services/bland/client.ts";
import {
  deleteConversationsByCallId,
  storeMessage,
} from "@shared/services/conversations/store.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { conversationId?: string }
      | null;
    if (!body?.conversationId) {
      return Response.json({ error: "conversationId required" }, { status: 400 });
    }
    const conversationId = body.conversationId;

    let r: Awaited<ReturnType<typeof bland.getConversation>>;
    try {
      r = await bland.getConversation(conversationId);
    } catch (e) {
      return Response.json({ error: `Bland fetch failed: ${(e as Error).message}` }, { status: 502 });
    }
    if (!r.ok || !r.json.data) {
      return Response.json(
        { error: `Bland ${r.status}: ${JSON.stringify(r.json.errors ?? r.json)}` },
        { status: 502 },
      );
    }
    const phone = r.json.data.user_number ?? "";
    if (!phone) return Response.json({ error: "No user_number" }, { status: 502 });
    const phone10 = phone.replace(/\D/g, "").slice(-10);
    const messages = r.json.data.messages ?? [];

    await deleteConversationsByCallId(phone10, conversationId);

    let stored = 0;
    let skipped = 0;
    const errors: string[] = [];
    for (const m of messages) {
      if (!m.message || m.message === "<Call Connected>") {
        skipped++;
        continue;
      }
      const sender: "Guest" | "AI Bot" = m.sender === "USER" ? "Guest" : "AI Bot";
      try {
        await storeMessage(phone10, conversationId, sender, m.message);
        stored++;
      } catch (e) {
        errors.push((e as Error).message);
      }
    }
    return Response.json({
      status: errors.length === 0 ? "success" : "partial",
      conversationId,
      phone: phone10,
      stored,
      skipped,
      errors,
    });
  },
});
