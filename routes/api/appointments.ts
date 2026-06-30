// Appointments Booked endpoint.
//
// Source-of-truth: scheduledinjections (pending) ∪ injectionhistory (fired).
// This is the canonical pipeline state — every booking that flows through
// /sms-callback/appointment-booked writes a scheduledinjection, then the
// cron sweep moves it to injectionhistory when it fires.
//
// Pre-fix listed BOTH collections at 50_000 each on every page load, then
// dedupes/sorts/paginates in memory. Now paginates injectionhistory with
// orderBy(firedAt desc) + limit so the wire cost is ~pageSize docs.
// scheduledinjections stays a full list because it's small (≤ few
// hundred active records) and we need all of them to dedupe with history.
// See firestore-safety.md.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { etDayBoundaryIso } from "@shared/util/time.ts";

// scheduledinjections rarely exceeds a few hundred active records (it's
// drained by the every-minute sweep). 5_000 is a generous safety ceiling
// well below the legacy 50k. If this ever fires the safety rail in
// wrapper.list(), it means we have a stuck sweep — investigate, don't
// bump the cap.
const PENDING_LIMIT = 5_000;

interface AppointmentRow {
  phoneNumber: string;
  eventTime: string | null;
  bookedAt: string | null;
  status: "scheduled" | "fired" | "errored";
  source: "scheduledinjections" | "injectionhistory";
  injectionStatus: string | null;
  firedBy: string | null;
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

    // The UI sends YYYY-MM-DD as ET calendar days. Resolve each to the correct
    // UTC instant for the ET day boundary (DST-aware). A bare
    // `new Date("YYYY-MM-DDT00:00:00")` would be parsed as the server's local
    // time (UTC on Deploy) = ~19:00 the prior ET day, pulling in the previous
    // evening's appointments and dropping early-morning ones.
    const startIso = etDayBoundaryIso(startDate, "start");
    const endIso = etDayBoundaryIso(endDate, "end");

    const db = getFirestoreClient();

    // Build the history query. Date range maps to firedAt, since that's
    // the canonical "when the appointment fired" timestamp. Auto-indexed
    // single-field; no composite index needed for orderBy + single-field
    // range filter on the same field.
    const historyOpts: Parameters<typeof db.list>[1] = {
      orderBy: { field: "firedAt", dir: "desc" },
      limit: Math.min(page * pageSize + pageSize, 5000),
    };
    if (startIso) {
      historyOpts.where = { field: "firedAt", op: ">=", value: startIso };
    } else if (endIso) {
      historyOpts.where = { field: "firedAt", op: "<=", value: endIso };
    }

    const [pending, history] = await Promise.all([
      db.list(scheduledInjectionsCollection, { limit: PENDING_LIMIT }),
      db.list(injectionHistoryCollection, historyOpts),
    ]);

    const rows: AppointmentRow[] = [];
    for (const e of pending) {
      const data = e.data as Record<string, unknown>;
      const phone10 = String(data.phone ?? e.id);
      if (!phone10 || phone10.length !== 10) continue;
      if (isExcludedFromReporting(phone10)) continue;
      const eventTime = typeof data.eventTime === "string"
        ? data.eventTime
        : null;
      const scheduledAtRaw = data.scheduledAt;
      const bookedAt = typeof scheduledAtRaw === "string"
        ? scheduledAtRaw
        : typeof scheduledAtRaw === "number"
        ? new Date(scheduledAtRaw).toISOString()
        : null;
      rows.push({
        phoneNumber: phone10,
        eventTime,
        bookedAt,
        status: "scheduled",
        source: "scheduledinjections",
        injectionStatus: null,
        firedBy: null,
      });
    }
    for (const e of history) {
      const sep = e.id.indexOf("__");
      const phone10 = sep >= 0 ? e.id.slice(0, sep) : e.id;
      if (!phone10 || phone10.length !== 10) continue;
      if (isExcludedFromReporting(phone10)) continue;
      const data = e.data as Record<string, unknown>;
      const eventTime = typeof data.eventTime === "string"
        ? data.eventTime
        : null;
      const firedAt = typeof data.firedAt === "string" ? data.firedAt : null;
      const status = typeof data.status === "string" &&
          data.status.toLowerCase() !== "success"
        ? "errored"
        : "fired";
      rows.push({
        phoneNumber: phone10,
        eventTime,
        bookedAt: firedAt,
        status,
        source: "injectionhistory",
        injectionStatus: typeof data.status === "string" ? data.status : null,
        firedBy: typeof data.firedBy === "string" ? data.firedBy : null,
      });
    }

    // Dedupe by phone10. Prefer the row with the latest eventTime so a
    // rebook (newer scheduledinjection) wins over the old fired record.
    const byPhone = new Map<string, AppointmentRow>();
    for (const r of rows) {
      const cur = byPhone.get(r.phoneNumber);
      if (!cur) {
        byPhone.set(r.phoneNumber, r);
        continue;
      }
      const curT = cur.eventTime ?? "";
      const newT = r.eventTime ?? "";
      if (newT > curT) byPhone.set(r.phoneNumber, r);
    }

    const start = startIso ? new Date(startIso).getTime() : null;
    const end = endIso ? new Date(endIso).getTime() : null;
    const filtered = [...byPhone.values()].filter((r) => {
      if (!r.bookedAt) return start == null && end == null;
      const t = new Date(r.bookedAt).getTime();
      if (!Number.isFinite(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    }).sort((
      a,
      b,
    ) => (a.bookedAt && b.bookedAt && a.bookedAt < b.bookedAt ? 1 : -1));

    const total = filtered.length;
    const items = filtered.slice((page - 1) * pageSize, page * pageSize);

    return Response.json({
      items,
      total,
      page,
      pageSize,
      // Legacy compatibility — old callers expect `matches` + `count`.
      matches: items,
      count: total,
    });
  },
});
