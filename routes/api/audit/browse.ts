// Paged audit list. Optional ?stage=<name> browses
// sms-bot/auditstage/{stage}/* instead of the legacy global collection.
// Date range filters processedAt.
//
// Pre-fix this listed 5000 docs and filtered + sorted in memory. Now uses
// orderBy(processedAt desc) + database-side range filter on the same
// field (single-field auto-index). Wire cost drops from 5000 docs/page
// to ~pageSize docs/page.

import { define } from "@/utils.ts";
import {
  auditCollection,
  auditStageCollection,
} from "@shared/firestore/paths.ts";
import {
  getFirestoreClient,
  type ListOptions,
} from "@shared/firestore/wrapper.ts";
import { sanitizeStage } from "@shared/services/audit/service.ts";
import type { AuditMarker } from "@shared/types/audit.ts";
import { easternDateString, etDayBoundaryIso } from "@shared/util/time.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const stage = sanitizeStage(url.searchParams.get("stage"));
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const recordIdFilter = url.searchParams.get("recordId");
    const page = Math.max(1, Number(url.searchParams.get("page") ?? 1));
    const pageSize = Math.max(
      1,
      Math.min(500, Number(url.searchParams.get("pageSize") ?? 50)),
    );

    // The UI sends YYYY-MM-DD as ET calendar days; resolve each to the correct
    // UTC instant for the ET day boundary (DST-aware). A bare
    // `new Date("YYYY-MM-DDT00:00:00")` parses as the server's local time
    // (UTC on Deploy), shifting the window ~5 hours.
    const startIso = etDayBoundaryIso(startDate, "start");
    const endIso = etDayBoundaryIso(endDate, "end");

    const parent = stage ? auditStageCollection(stage) : auditCollection;

    // Database-side ordering + filtering. Date range maps to processedAt
    // (the same field we order by, so no composite index needed).
    const opts: ListOptions = {
      orderBy: { field: "processedAt", dir: "desc" },
      limit: Math.min(page * pageSize + pageSize, 2000),
    };
    if (startIso) {
      opts.where = { field: "processedAt", op: ">=", value: startIso };
    } else if (endIso) {
      opts.where = { field: "processedAt", op: "<=", value: endIso };
    }

    const all = await getFirestoreClient().list(parent, opts);

    const records = all
      .map((e) => {
        const v = e.data as unknown as AuditMarker;
        return {
          recordId: e.id,
          processedAt: v.processedAt,
          source: v.source,
          stage: v.stage,
        };
      })
      .filter((r) => {
        if (recordIdFilter && !r.recordId.includes(recordIdFilter)) {
          return false;
        }
        // Date range second-pass — the database `where` already covered
        // one side (start OR end); if both are present we filter the
        // other side here (Firestore would otherwise require a composite
        // index for two range filters on the same field, which isn't
        // worth it for this admin tool).
        if (startIso && r.processedAt < startIso) return false;
        if (endIso && r.processedAt > endIso) return false;
        return true;
      });

    const total = records.length;
    // "Today" means ET today, not UTC-local today. setHours(0,0,0,0) on a UTC
    // server bucketed ET records from 19:00–23:59 ET (the prior calendar day in
    // UTC) into the wrong day. Resolve ET-midnight-as-UTC instead.
    const todayStartMs = new Date(
      etDayBoundaryIso(easternDateString(), "start")!,
    ).getTime();
    const todayCount = records.filter((r) =>
      new Date(r.processedAt).getTime() >= todayStartMs
    ).length;
    const latest = records[0]?.processedAt ?? null;

    const offset = (page - 1) * pageSize;
    const paged = records.slice(offset, offset + pageSize);

    return Response.json({ total, todayCount, latest, records: paged });
  },
});
