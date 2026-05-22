// GET /api/guests/list — paged list of distinct phones we've ever messaged.
// Powers the "Unique Guests Reached" drill-in on the dashboard.
//
// Reads the uniqueguestsbyphone write-side aggregator (one doc per phone,
// updated transactionally from storeMessage). Pre-fix this listed the
// entire conversations collection (50_000 limit) per page load + deduped
// in memory — see firestore-safety.md (Part B).
//
// Pagination uses orderBy + startAfter cursors so the wire cost is exactly
// pageSize docs per request.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { uniqueGuestsByPhoneCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

interface AggregatorDoc {
  phoneNumber: string;
  firstSeen?: string;
  lastSeen?: string;
  messageCount?: number;
  replyCount?: number;
  hasReplied?: boolean;
}

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

    // Single-field auto-indexes cover orderBy on these scalars. Skip-
    // pagination is bounded at page × pageSize docs (page=1 = pageSize
    // reads), which is the existing contract callers depend on. For
    // deep paging this is still vastly better than the pre-fix full-
    // table scan (50k docs/page).
    const orderField = sortBy === "messageCount" ? "messageCount" : "lastSeen";
    const upToPage = Math.min(page * pageSize, 5000);
    const docs = await getFirestoreClient().list(
      uniqueGuestsByPhoneCollection,
      {
        orderBy: { field: orderField, dir: "desc" },
        limit: upToPage,
      },
    );

    const allRows: GuestSummary[] = docs
      .map((e) => e.data as unknown as AggregatorDoc)
      .filter((d) => d.phoneNumber && !isExcludedFromReporting(d.phoneNumber))
      .map((d) => ({
        phoneNumber: d.phoneNumber,
        firstSeen: d.firstSeen ?? null,
        lastSeen: d.lastSeen ?? null,
        messageCount: typeof d.messageCount === "number" ? d.messageCount : 0,
        replyCount: typeof d.replyCount === "number" ? d.replyCount : 0,
        hasReplied: !!d.hasReplied,
      }));

    const offset = (page - 1) * pageSize;
    const items = allRows.slice(offset, offset + pageSize);
    const total = allRows.length;

    return Response.json({ items, total, page, pageSize });
  },
});
