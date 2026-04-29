// Paged audit list. Optional ?stage=<name> browses
// sms-bot/auditstage/{stage}/* instead of the legacy global collection.
// Date range filters processedAt.

import { define } from "@/utils.ts";
import {
  auditCollection,
  auditStageCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { sanitizeStage } from "@shared/services/audit/service.ts";
import type { AuditMarker } from "@shared/types/audit.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const stage = sanitizeStage(url.searchParams.get("stage"));
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const recordIdFilter = url.searchParams.get("recordId");
    const page = Number(url.searchParams.get("page") ?? 1);
    const pageSize = Number(url.searchParams.get("pageSize") ?? 50);

    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    const parent = stage ? auditStageCollection(stage) : auditCollection;
    const all = await getFirestoreClient().list(parent, { limit: 5000 });

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
        if (recordIdFilter && !r.recordId.includes(recordIdFilter)) return false;
        const t = new Date(r.processedAt).getTime();
        if (!Number.isFinite(t)) return false;
        if (start && t < start) return false;
        if (end && t > end) return false;
        return true;
      })
      .sort((a, b) => (a.processedAt < b.processedAt ? 1 : -1));

    const total = records.length;
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayCount = records.filter((r) =>
      new Date(r.processedAt).getTime() >= todayStart.getTime()
    ).length;
    const latest = records[0]?.processedAt ?? null;

    const offset = (page - 1) * pageSize;
    const paged = records.slice(offset, offset + pageSize);

    return Response.json({ total, todayCount, latest, records: paged });
  },
});
