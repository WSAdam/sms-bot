// Dashboard / review drill-in. Returns conversation messages within an
// optional date range, optionally filtered by sender / nodeTag / phone.
// Response shape matches the legacy main.ts: { items: [...], count }.
//
// Pre-fix this listed the entire conversations collection (50_000 limit)
// on every page load, then filtered in memory. Now picks the most
// selective filter as a database-side where + orderBy(timestamp desc)
// + limit(MAX_ITEMS), and applies remaining filters in-memory on the
// much smaller result set. Composite indexes for (phoneNumber|sender|
// nodeTag, timestamp desc) are defined in firestore.indexes.json.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { conversationsCollection } from "@shared/firestore/paths.ts";
import {
  getFirestoreClient,
  type ListOptions,
} from "@shared/firestore/wrapper.ts";
import { dedupeMessages } from "@shared/services/conversations/dedupe.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const MAX_ITEMS = 500;

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const senderFilter = url.searchParams.get("sender") ?? "";
    const nodeTagFilter = url.searchParams.get("nodeTag") ?? "";
    const phoneFilter = url.searchParams.get("phone") ?? "";

    // Eastern-time day boundaries — matches the legacy contract.
    const startIso = startDate
      ? new Date(`${startDate}T00:00:00-04:00`).toISOString()
      : null;
    const endIso = endDate
      ? new Date(`${endDate}T23:59:59-04:00`).toISOString()
      : null;

    // Choose the most-selective filter for the database `where` clause.
    // Order: phone (per-phone, very selective) > timestamp range (when set,
    // typically narrower than sender's 2 values or nodeTag's few dozen) >
    // sender > nodeTag. Composite indexes in firestore.indexes.json cover
    // each (filter, timestamp desc) pair; timestamp alone uses the
    // auto-indexed single-field index.
    //
    // Why prefer timestamp over sender when both are set: the previous
    // priority used sender as the primary `where`, fetched the latest 500
    // AI Bot messages globally, then filtered in-memory by date range. If
    // the date range was older than those 500 (any backlog of recent
    // sends), the drill returned 0 — even though the stats card showed
    // a non-zero count for the same range. Flipping the order means the
    // 500-doc page is anchored to the requested window, not to "now."
    let opts: ListOptions = {
      orderBy: { field: "timestamp", dir: "desc" },
      limit: MAX_ITEMS,
    };
    let primaryFilter: "phone" | "sender" | "nodeTag" | "none" = "none";
    if (phoneFilter) {
      opts = {
        ...opts,
        where: { field: "phoneNumber", op: "==", value: phoneFilter },
      };
      primaryFilter = "phone";
    } else if (startIso || endIso) {
      // Single-field timestamp index. The other-end clamp (and any
      // sender/nodeTag) is applied in-memory on the bounded result.
      const tsWhere = startIso
        ? { field: "timestamp", op: ">=" as const, value: startIso }
        : { field: "timestamp", op: "<=" as const, value: endIso! };
      opts = { ...opts, where: tsWhere };
    } else if (senderFilter) {
      opts = {
        ...opts,
        where: { field: "sender", op: "==", value: senderFilter },
      };
      primaryFilter = "sender";
    } else if (nodeTagFilter) {
      opts = {
        ...opts,
        where: { field: "nodeTag", op: "==", value: nodeTagFilter },
      };
      primaryFilter = "nodeTag";
    }

    const matches = await getFirestoreClient().list(
      conversationsCollection,
      opts,
    );

    // Apply remaining filters client-side on the bounded result set.
    const deduped = dedupeMessages(
      matches
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
      if (ts && (startIso || endIso)) {
        if (startIso && ts < startIso) continue;
        if (endIso && ts > endIso) continue;
      }
      if (
        primaryFilter !== "sender" && senderFilter &&
        String(v.sender ?? "") !== senderFilter
      ) continue;
      if (
        primaryFilter !== "nodeTag" && nodeTagFilter &&
        (v.nodeTag ?? "") !== nodeTagFilter
      ) continue;
      if (
        primaryFilter !== "phone" && phoneFilter &&
        v.phoneNumber !== phoneFilter
      ) continue;

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
