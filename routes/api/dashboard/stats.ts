// Aggregated dashboard stats. Intentionally pragmatic — counts are derived by
// listing each container collection and tallying. For very large datasets
// these reads get expensive; consider precomputing into a `stats` doc later.

import { define } from "@/utils.ts";
import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
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

// Bumped from 5,000 → 50,000 so we count past the historical-data cap.
// Audit currently has ~37,715 docs; conversations ~7,077 + growth.
const LIST_LIMIT = 50_000;

interface BreakdownEntry {
  count: number;
  latest: string | null;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");

    // Eastern-time day boundaries (mirrors drill.ts).
    const startMs = startDate
      ? new Date(`${startDate}T00:00:00-04:00`).getTime()
      : null;
    const endMs = endDate
      ? new Date(`${endDate}T23:59:59-04:00`).getTime()
      : null;

    const db = getFirestoreClient();
    const breakdown: Record<string, BreakdownEntry> = {};
    let totalKv = 0;

    // Each container's docs (raw, no dedupe — these are storage stats).
    for (const [container, sub] of PREFIXES) {
      const list = await db.list(`${ROOT_COLLECTION}/${container}/${sub}`, {
        limit: LIST_LIMIT,
      });
      const latest = list
        .map((e) => extractTimestamp(e.data))
        .filter((t): t is string => !!t)
        .sort()
        .pop() ?? null;
      breakdown[container] = { count: list.length, latest };
      totalKv += list.length;
    }

    // Conversation-derived stats: dedupe + date-filter before counting.
    const allMessages = await db.list(
      `${ROOT_COLLECTION}/conversations/messages`,
      { limit: LIST_LIMIT },
    );
    const allMsgs = allMessages.map((e) =>
      e.data as unknown as ConversationMessage
    );
    const deduped = dedupeMessages(allMsgs);
    const filtered = inWindow(deduped, startMs, endMs);

    const phonesSeen = new Set<string>();
    const phonesReplied = new Set<string>();
    let appointmentsSet = 0;

    for (const m of filtered) {
      phonesSeen.add(m.phoneNumber);
      if (m.sender === "Guest") phonesReplied.add(m.phoneNumber);
      if ((m.nodeTag ?? "").toLowerCase().includes("appointment scheduled")) {
        appointmentsSet++;
      }
    }
    const initialTextsSent = phonesSeen.size;

    // Lifetime appointments — same heuristic, no date filter.
    let lifetimeAppointmentsBooked = 0;
    for (const m of deduped) {
      if ((m.nodeTag ?? "").toLowerCase().includes("appointment scheduled")) {
        lifetimeAppointmentsBooked++;
      }
    }

    // Recent activity also needs dedupe (the user was seeing 4× of the same
    // line in the table). Don't apply the date filter here — recent activity
    // is intentionally a global "what's happening now" feed.
    const recentEntries = deduped
      .map((m) => ({
        key: ["conversations", `${m.phoneNumber}__${m.callId}__${m.timestamp}`],
        value: m as unknown as Record<string, unknown>,
      }))
      .sort((a, b) => {
        const ta = extractTimestamp(a.value) ?? "";
        const tb = extractTimestamp(b.value) ?? "";
        return ta < tb ? 1 : -1;
      })
      .slice(0, 50);

    return Response.json({
      stats: {
        // Date-filtered (driven by Start/End Date pickers)
        textsSent: filtered.length,
        uniquePhonesSent: phonesSeen.size,
        initialTextsSent,
        peopleReplied: phonesReplied.size,
        appointmentsSet,
        // Lifetime — date-filter-independent
        totalKvEntries: totalKv,
        activatedCount: breakdown.guestactivated?.count ?? 0,
        answeredCount: breakdown.guestanswered?.count ?? 0,
        lifetimeAppointmentsBooked,
        lifetimeSalesMatched: breakdown.saleswithin7d?.count ?? 0,
        lifetimeUniqueGuests: new Set(deduped.map((m) => m.phoneNumber)).size,
      },
      kvBreakdown: breakdown,
      recentEntries,
    });
  },
});

function inWindow(
  msgs: ConversationMessage[],
  startMs: number | null,
  endMs: number | null,
): ConversationMessage[] {
  if (startMs == null && endMs == null) return msgs;
  return msgs.filter((m) => {
    const t = m.timestamp ? new Date(m.timestamp).getTime() : NaN;
    if (!Number.isFinite(t)) return false;
    if (startMs != null && t < startMs) return false;
    if (endMs != null && t > endMs) return false;
    return true;
  });
}

function extractTimestamp(v: Record<string, unknown>): string | null {
  if (typeof v.timestamp === "string") return v.timestamp;
  if (typeof v.processedAt === "string") return v.processedAt;
  if (typeof v.scheduledAt === "string") return v.scheduledAt;
  if (typeof v.createdAt === "string") return v.createdAt;
  if (typeof v.activatedAt === "string") return v.activatedAt;
  if (typeof v.answeredAt === "string") return v.answeredAt;
  return null;
}
