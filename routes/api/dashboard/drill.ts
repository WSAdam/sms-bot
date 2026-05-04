// Dashboard / review drill-in. Returns conversation messages within an
// optional date range, optionally filtered by sender / nodeTag / phone.
// Response shape matches the legacy main.ts: { items: [...], count }.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const MAX_ITEMS = 500;
const LIST_LIMIT = 50_000;

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const senderFilter = url.searchParams.get("sender") ?? "";
    const nodeTagFilter = url.searchParams.get("nodeTag") ?? "";
    const phoneFilter = url.searchParams.get("phone") ?? "";

    // Eastern-time day boundaries — matches the legacy contract.
    const start = startDate ? new Date(`${startDate}T00:00:00-04:00`) : null;
    const end = endDate ? new Date(`${endDate}T23:59:59-04:00`) : null;

    const all = await getFirestoreClient().list(conversationsCollection, {
      limit: LIST_LIMIT,
    });

    // Collapse historical Bland-pathway dupes + drop test-phone traffic
    // before applying user filters. Otherwise drill-ins surface duplicate
    // rows and inflate counts with Adam's own test SMS.
    const deduped = dedupeMessages(
      all
        .map((e) => e.data as unknown as ConversationMessage)
        .filter((m) => !isExcludedFromReporting(m.phoneNumber)),
    );

    const items: Array<{
      phoneNumber: string | null;
      callId: string | null;
      sender: string | null;
      nodeTag: string | null;
      message: string | null;
      timestamp: string | null;
    }> = [];

    for (const v of deduped) {
      const ts = v.timestamp ?? null;

      if (ts && (start || end)) {
        const t = new Date(ts);
        if (start && t < start) continue;
        if (end && t > end) continue;
      }
      if (senderFilter && String(v.sender ?? "") !== senderFilter) continue;
      if (nodeTagFilter && (v.nodeTag ?? "") !== nodeTagFilter) continue;
      if (phoneFilter && v.phoneNumber !== phoneFilter) continue;

      items.push({
        phoneNumber: v.phoneNumber ?? null,
        callId: v.callId ?? null,
        sender: v.sender ?? null,
        nodeTag: v.nodeTag ?? null,
        message: v.message ?? null,
        timestamp: ts,
      });
      if (items.length >= MAX_ITEMS) break;
    }

    items.sort((a, b) => {
      const at = a.timestamp ? new Date(a.timestamp).getTime() : -Infinity;
      const bt = b.timestamp ? new Date(b.timestamp).getTime() : -Infinity;
      return bt - at;
    });

    return Response.json({ items, count: items.length });
  },
});
