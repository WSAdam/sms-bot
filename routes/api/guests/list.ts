// GET /api/guests/list — paged list of distinct phones we've ever messaged.
// Powers the "Unique Guests Reached" drill-in on the dashboard. For each
// phone returns first-seen, last-seen, total messages, and whether they
// replied at all. Test phones (EXCLUDED_REPORTING_PHONES) are skipped.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const LIST_LIMIT = 50_000;

interface GuestSummary {
  phoneNumber: string;
  firstSeen: string | null;
  lastSeen: string | null;
  messageCount: number;
  replyCount: number;
  hasReplied: boolean;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("pageSize") ?? 50)),
    );
    const sortBy = url.searchParams.get("sortBy") ?? "lastSeen"; // lastSeen | messageCount

    const all = await getFirestoreClient().list(conversationsCollection, {
      limit: LIST_LIMIT,
    });
    const deduped = dedupeMessages(
      all
        .map((e) => e.data as unknown as ConversationMessage)
        .filter((m) => !isExcludedFromReporting(m.phoneNumber)),
    );

    const byPhone = new Map<string, GuestSummary>();
    for (const m of deduped) {
      const phone = m.phoneNumber;
      let g = byPhone.get(phone);
      if (!g) {
        g = {
          phoneNumber: phone,
          firstSeen: null,
          lastSeen: null,
          messageCount: 0,
          replyCount: 0,
          hasReplied: false,
        };
        byPhone.set(phone, g);
      }
      g.messageCount++;
      if (m.sender === "Guest") {
        g.replyCount++;
        g.hasReplied = true;
      }
      const ts = m.timestamp ?? null;
      if (ts && (!g.firstSeen || ts < g.firstSeen)) g.firstSeen = ts;
      if (ts && (!g.lastSeen || ts > g.lastSeen)) g.lastSeen = ts;
    }

    const sorted = Array.from(byPhone.values()).sort((a, b) => {
      if (sortBy === "messageCount") return b.messageCount - a.messageCount;
      // default: most-recent contact first
      return (b.lastSeen ?? "").localeCompare(a.lastSeen ?? "");
    });

    const total = sorted.length;
    const items = sorted.slice((page - 1) * pageSize, page * pageSize);

    return Response.json({ items, total, page, pageSize });
  },
});
