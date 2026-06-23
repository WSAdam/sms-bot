// Legacy by-phone conversation search.

import { define } from "@/utils.ts";
import { getAllConversations } from "@shared/services/conversations/store.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const phone = url.searchParams.get("phone") ?? "";
    if (!phone) {
      return Response.json({ error: "Missing phone" }, { status: 400 });
    }
    // Dedupe at read (callId+sender+message, earliest wins) so storage-level
    // duplicates — from the per-call webhook, the nightly reseed, and the
    // on-booking transcript ingest all writing the same line — collapse to one.
    const messages = dedupeMessages(await getAllConversations(phone));
    return Response.json({ phone, count: messages.length, messages });
  },
});
