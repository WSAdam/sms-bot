// Paginated drill-in for the "Activated Guests" dashboard card. Pre-
// refactor this lived in the page's JS as 3 parallel /api/kv/list
// calls that scanned guestactivated + leadpointer + calldispositions
// at limit:50_000 — the 5,320-doc calldispositions scan was the main
// cost. Now: list guestactivated with orderBy + limit, then decorate
// only the visible rows with per-phone gets.
//
// Response shape:
//   {
//     items: [{ phone10, activatedAt, eventTime, withinDays,
//                matchReason, activator, office, eventTimePlaceholder,
//                pointer: {...} | null, calls: [...], confirmedCalledAt,
//                lastDisposition }],
//     total: number,         // exact for now (small collection)
//     page, pageSize
//   }

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  callDispositionsCollection,
  guestActivatedCollection,
  leadPointerDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

interface CallDisposition {
  phone10?: string;
  callTime?: string;
  status?: string;
  isAnswered?: boolean;
  campaignId?: string;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(200, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    const db = getFirestoreClient();

    // guestactivated is small (~30 docs lifetime today; even at 1000
    // it's fine). orderBy(activatedAt desc) is single-field auto-
    // indexed. We fetch enough docs to cover the requested page plus
    // a safety margin for excluded-phone filtering.
    const fetchLimit = Math.min(page * pageSize + pageSize + 50, 5_000);
    const raw = await db.list(guestActivatedCollection, {
      orderBy: { field: "activatedAt", dir: "desc" },
      limit: fetchLimit,
    });

    const filtered = raw.filter((e) => !isExcludedFromReporting(e.id));
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const pageRows = filtered.slice(offset, offset + pageSize);

    // Decorate only the visible rows. Parallel per-phone queries:
    // - leadpointer/byPhone/{phone} via single db.get
    // - calldispositions/byPhone where(phone10 == phone) via small list
    // For pageSize=50 that's 100 ops in parallel — ~200ms total.
    const decorated = await Promise.all(pageRows.map(async (e) => {
      const data = e.data as Record<string, unknown>;
      const phone10 = String(data.phone10 ?? e.id);
      const [pointer, dispoList] = await Promise.all([
        db.get(leadPointerDocPath(phone10)),
        db.list(callDispositionsCollection, {
          where: { field: "phone10", op: "==", value: phone10 },
          limit: 100,
        }),
      ]);
      const calls = dispoList.map((d) => d.data as CallDisposition);
      const saleMs = typeof data.activatedAt === "string"
        ? new Date(data.activatedAt).getTime()
        : NaN;
      // Earliest call before the sale, used by the dashboard's
      // "Confirmed Called" column. Returns the full disposition object
      // so the JS column renderer can show the call's outcome string.
      let confirmedCall: CallDisposition | null = null;
      let bestMs = Infinity;
      for (const c of calls) {
        const t = c.callTime ? new Date(c.callTime).getTime() : NaN;
        if (!Number.isFinite(t)) continue;
        if (Number.isFinite(saleMs) && t > saleMs) continue;
        if (t < bestMs) {
          bestMs = t;
          confirmedCall = c;
        }
      }
      // Most recent call BEFORE the sale, used by the "Last Disposition"
      // column. Same shape — caller reads .disposition off it.
      let lastDisposition: CallDisposition | null = null;
      let lastMs = -Infinity;
      for (const c of calls) {
        const t = c.callTime ? new Date(c.callTime).getTime() : NaN;
        if (!Number.isFinite(t)) continue;
        if (Number.isFinite(saleMs) && t > saleMs) continue;
        if (t > lastMs) {
          lastMs = t;
          lastDisposition = c;
        }
      }
      return {
        phone10,
        Activated: true, // legacy field the dashboard JS reads
        activatedAt: data.activatedAt ?? null,
        eventTime: data.eventTime ?? null,
        eventTimePlaceholder: data.eventTimePlaceholder === true,
        withinDays: typeof data.withinDays === "number"
          ? data.withinDays
          : null,
        matchReason: data.matchReason ?? null,
        activator: data.activator ?? null,
        office: data.office ?? null,
        pointer: pointer ?? null,
        confirmedCall,
        lastDisposition,
        callCount: calls.length,
      };
    }));

    return Response.json({
      items: decorated,
      total,
      page,
      pageSize,
    }, { headers: { "Cache-Control": "no-store" } });
  },
});
