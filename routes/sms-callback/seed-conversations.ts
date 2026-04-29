// Bulk re-seed conversation history from a list of Bland conversation IDs.
// Idempotent — re-seeding a conversation overwrites prior entries.
// Drops the legacy 100/300 ms artificial delays — Firestore handles bursts fine.

import { define } from "@/utils.ts";
import * as bland from "@shared/services/bland/client.ts";
import {
  deleteConversationsByCallId,
  storeMessage,
} from "@shared/services/conversations/store.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { conversationIds?: string[] }
      | null;
    const ids = body?.conversationIds ?? [];
    if (!ids.length) return Response.json({ error: "conversationIds required" }, { status: 400 });

    const results: Record<string, { status: string; stored?: number; skipped?: number; error?: string }> = {};

    for (const conversationId of ids) {
      try {
        const r = await bland.getConversation(conversationId);
        if (!r.ok || !r.json.data) {
          results[conversationId] = {
            status: "error",
            error: `Bland ${r.status}: ${JSON.stringify(r.json.errors ?? r.json)}`.slice(0, 200),
          };
          continue;
        }
        const phone = r.json.data.user_number ?? "";
        if (!phone) {
          results[conversationId] = { status: "error", error: "no user_number" };
          continue;
        }
        const phone10 = phone.replace(/\D/g, "").slice(-10);
        const messages = r.json.data.messages ?? [];

        // Idempotent overwrite: clear existing entries first.
        await deleteConversationsByCallId(phone10, conversationId);

        let stored = 0;
        let skipped = 0;
        for (const m of messages) {
          if (!m.message || m.message === "<Call Connected>") {
            skipped++;
            continue;
          }
          const sender: "Guest" | "AI Bot" = m.sender === "USER" ? "Guest" : "AI Bot";
          await storeMessage(phone10, conversationId, sender, m.message);
          stored++;
        }
        results[conversationId] = { status: "success", stored, skipped };
      } catch (e) {
        results[conversationId] = { status: "error", error: (e as Error).message };
      }
    }

    const succeeded = Object.values(results).filter((r) => r.status === "success").length;
    const failed = Object.values(results).filter((r) => r.status === "error").length;
    return Response.json({ status: "done", total: ids.length, succeeded, failed, results });
  },
});
