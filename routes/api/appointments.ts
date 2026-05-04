// Appointment-tagged conversations (paged). Returns conversation messages
// whose nodeTag matches the appointment heuristic, optionally bounded by
// a date range.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const APPT_KEYWORDS = ["appointment scheduled"];
const LIST_LIMIT = 50_000;

function isAppointmentMatch(msg: ConversationMessage): boolean {
  const tag = (msg.nodeTag ?? "").toLowerCase();
  return APPT_KEYWORDS.some((kw) => tag.includes(kw));
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    const all = await getFirestoreClient().list(conversationsCollection, {
      limit: LIST_LIMIT,
    });
    const allMatches = dedupeMessages(
      all
        .map((e) => e.data as unknown as ConversationMessage)
        .filter((m) => !isExcludedFromReporting(m.phoneNumber)),
    )
      .filter(isAppointmentMatch)
      .filter((m) => {
        const t = new Date(m.timestamp).getTime();
        if (!Number.isFinite(t)) return false;
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
      })
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));

    const total = allMatches.length;
    const items = allMatches.slice((page - 1) * pageSize, page * pageSize);

    // Both `items`/`total` (frontend dashboard expects these) and
    // `matches`/`count` (legacy clients) are returned for compatibility.
    return Response.json({
      items,
      total,
      page,
      pageSize,
      matches: items,
      count: total,
    });
  },
});
