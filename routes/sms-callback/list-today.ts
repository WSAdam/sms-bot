// Lists today's Bland conversation IDs (UTC midnight → now). Used to feed
// the seed-conversations endpoint when backfilling conversation history.

import { define } from "@/utils.ts";
import * as bland from "@shared/services/bland/client.ts";

export const handler = define.handlers({
  async GET() {
    try {
      const r = await bland.listConversationsToday();
      return Response.json({
        total: r.conversations.length,
        from: r.from,
        conversations: r.conversations.map((c) => ({
          id: c.id,
          phone: c.user_number,
          messageCount: c.message_count,
          createdAt: c.created_at,
        })),
        conversationIds: r.conversations.map((c) => c.id),
      });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 502 });
    }
  },
});
