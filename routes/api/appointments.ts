// Appointments Booked endpoint.
//
// Source-of-truth: scheduledinjections (pending) ∪ injectionhistory (fired).
// This is the canonical pipeline state — every booking that flows through
// /sms-callback/appointment-booked writes a scheduledinjection, then the
// cron sweep moves it to injectionhistory when it fires. Walking those two
// collections gives us the true "appointments booked" set.
//
// Previous version walked conversations for nodeTag="appointment scheduled"
// — that signal vanished when Bland's pathway template changed and stopped
// sending "Appointment Scheduled: X" messages, masking real bookings.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const LIST_LIMIT = 50_000;

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

    const start = startDate ? new Date(`${startDate}T00:00:00`).getTime() : null;
    const end = endDate ? new Date(`${endDate}T23:59:59.999`).getTime() : null;

    const db = getFirestoreClient();
    const [pending, history] = await Promise.all([
      db.list(scheduledInjectionsCollection, { limit: LIST_LIMIT }),
      db.list(injectionHistoryCollection, { limit: LIST_LIMIT }),
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
      const status =
        typeof data.status === "string" && data.status.toLowerCase() !== "success"
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

    // Apply date range filter on bookedAt (when we received the booking),
    // matching the dashboard's "Booked At" semantic.
    const filtered = [...byPhone.values()].filter((r) => {
      if (!r.bookedAt) return start == null && end == null;
      const t = new Date(r.bookedAt).getTime();
      if (!Number.isFinite(t)) return false;
      if (start != null && t < start) return false;
      if (end != null && t > end) return false;
      return true;
    }).sort((a, b) => (a.bookedAt && b.bookedAt && a.bookedAt < b.bookedAt ? 1 : -1));

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
