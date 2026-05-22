// Paginated drill-in for the "Answered Guests" dashboard card. Pre-
// refactor this scanned the entire guestanswered collection at
// limit:50_000 via /api/kv/list. Collection has ~149 docs today, so
// the pre-refactor cost was bounded but the pattern was wrong (the
// safety rail would fire if it grew). Now: orderBy(answeredAt desc)
// + limit. No decoration needed for this drill — the only fields
// rendered are phone10 + answeredAt + answered.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { guestAnsweredCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(200, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    const db = getFirestoreClient();
    const fetchLimit = Math.min(page * pageSize + pageSize + 50, 5_000);
    const raw = await db.list(guestAnsweredCollection, {
      orderBy: { field: "answeredAt", dir: "desc" },
      limit: fetchLimit,
    });

    const filtered = raw.filter((e) => !isExcludedFromReporting(e.id));
    const total = filtered.length;
    const offset = (page - 1) * pageSize;
    const pageRows = filtered.slice(offset, offset + pageSize).map((e) => {
      const data = e.data as Record<string, unknown>;
      return {
        phone10: String(data.phone10 ?? e.id),
        answeredAt: data.answeredAt ?? null,
        answered: data.answered === true,
      };
    });

    return Response.json({
      items: pageRows,
      total,
      page,
      pageSize,
    }, { headers: { "Cache-Control": "no-store" } });
  },
});
