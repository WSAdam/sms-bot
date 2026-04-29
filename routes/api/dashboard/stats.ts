// Aggregated dashboard stats. Intentionally pragmatic — counts are derived by
// listing each container collection and tallying. For very large datasets
// these reads get expensive; consider precomputing into a `stats` doc later.

import { define } from "@/utils.ts";
import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const PREFIXES = [
  ["conversations", "messages"],
  ["scheduledinjections", "byPhone"],
  ["smsflowcontext", "byPhone"],
  ["guestactivated", "byPhone"],
  ["guestanswered", "byPhone"],
  ["audit", "byRecordId"],
  ["saleswithin7d", "byPhone"],
  ["injectionhistory", "byPhone"],
  ["leadpointer", "byPhone"],
] as const;

interface BreakdownEntry {
  count: number;
  latest: string | null;
}

export const handler = define.handlers({
  async GET() {
    const db = getFirestoreClient();
    const breakdown: Record<string, BreakdownEntry> = {};
    let totalKv = 0;

    // Each container's docs
    for (const [container, sub] of PREFIXES) {
      const list = await db.list(`${ROOT_COLLECTION}/${container}/${sub}`, { limit: 5000 });
      const latest = list
        .map((e) => extractTimestamp(e.data))
        .filter((t): t is string => !!t)
        .sort()
        .pop() ?? null;
      breakdown[container] = { count: list.length, latest };
      totalKv += list.length;
    }

    // Conversation-derived stats
    const allMessages = await db.list(`${ROOT_COLLECTION}/conversations/messages`, {
      limit: 5000,
    });
    const phonesSeen = new Set<string>();
    const phonesReplied = new Set<string>();
    let initialTextsSent = 0;
    let appointmentsSet = 0;

    for (const e of allMessages) {
      const m = e.data as unknown as ConversationMessage;
      phonesSeen.add(m.phoneNumber);
      if (m.sender === "Guest") phonesReplied.add(m.phoneNumber);
      if ((m.nodeTag ?? "").toLowerCase().includes("appointment scheduled")) {
        appointmentsSet++;
      }
    }
    initialTextsSent = phonesSeen.size;

    const recentEntries = allMessages
      .map((e) => ({ key: ["conversations", e.id], value: e.data }))
      .sort((a, b) => {
        const ta = extractTimestamp(a.value) ?? "";
        const tb = extractTimestamp(b.value) ?? "";
        return ta < tb ? 1 : -1;
      })
      .slice(0, 50);

    return Response.json({
      stats: {
        textsSent: allMessages.length,
        uniquePhonesSent: phonesSeen.size,
        initialTextsSent,
        peopleReplied: phonesReplied.size,
        appointmentsSet,
        totalKvEntries: totalKv,
        activatedCount: breakdown.guestactivated?.count ?? 0,
        answeredCount: breakdown.guestanswered?.count ?? 0,
      },
      kvBreakdown: breakdown,
      recentEntries,
    });
  },
});

function extractTimestamp(v: Record<string, unknown>): string | null {
  if (typeof v.timestamp === "string") return v.timestamp;
  if (typeof v.processedAt === "string") return v.processedAt;
  if (typeof v.scheduledAt === "string") return v.scheduledAt;
  if (typeof v.createdAt === "string") return v.createdAt;
  if (typeof v.activatedAt === "string") return v.activatedAt;
  if (typeof v.answeredAt === "string") return v.answeredAt;
  return null;
}
