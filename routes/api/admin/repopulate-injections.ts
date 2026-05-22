// Walk every conversation message tagged "appointment scheduled", parse the
// appointment time from the message text, and write a scheduledinjection doc
// for any phone whose appointment is in the future AND doesn't already have
// a pending or fired injection record on file.
//
// Used to recover from cases where Bland's bot tagged the message but
// Cal.com / the appointment-booked webhook never POSTed, leaving the
// orchestrator with no scheduledinjection to fire.
//
// POST body: { dryRun?: boolean }

import { define } from "@/utils.ts";
import {
  conversationsCollection,
  injectionHistoryCollection,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

const APPT_RE =
  /appointment\s+scheduled\s*:\s*([A-Za-z]{3})\s+(\d{1,2}),\s+(\d{1,2}):(\d{2})\s+(AM|PM)/i;
const MONTHS: Record<string, number> = {
  jan: 0,
  feb: 1,
  mar: 2,
  apr: 3,
  may: 4,
  jun: 5,
  jul: 6,
  aug: 7,
  sep: 8,
  oct: 9,
  nov: 10,
  dec: 11,
};

// Parse "Appointment Scheduled: Apr 22, 9:15 AM" → ISO string.
// Year is taken from the message timestamp; if the parsed date is before
// the message timestamp we bump to year+1 (handles Dec→Jan rollover).
// Times are interpreted in Eastern Time (EDT = UTC-4 most of the year,
// good enough for our use case).
function parseAppointment(text: string, refIso: string): string | null {
  const m = text.match(APPT_RE);
  if (!m) return null;
  const [, mon, day, hourStr, minute, ampm] = m;
  const monthIdx = MONTHS[mon.toLowerCase().slice(0, 3)];
  if (monthIdx == null) return null;
  let h = parseInt(hourStr, 10);
  if (ampm.toUpperCase() === "PM" && h < 12) h += 12;
  if (ampm.toUpperCase() === "AM" && h === 12) h = 0;
  const refDate = new Date(refIso);
  const refMs = refDate.getTime();
  if (!Number.isFinite(refMs)) return null;

  for (const yearOffset of [0, 1]) {
    const year = refDate.getUTCFullYear() + yearOffset;
    const iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${
      String(parseInt(day, 10)).padStart(2, "0")
    }T${String(h).padStart(2, "0")}:${minute}:00-04:00`;
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) continue;
    // Allow appointments up to 12h before the message (rare clock skew).
    if (dt.getTime() >= refMs - 12 * 60 * 60 * 1000) return dt.toISOString();
  }
  return null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { dryRun?: boolean }
      | null;
    const dryRun = body?.dryRun === true;

    const db = getFirestoreClient();
    // Database-side filter on nodeTag — composite index
    // (nodeTag asc, timestamp desc) covers this. Pre-fix this listed all
    // 50k conversation messages and filtered in memory; now we only pull
    // the ~hundred-or-so messages tagged "appointment scheduled". The
    // injectionhistory lookup is now per-phone instead of a global scan.
    const apptMessages = await db.list(conversationsCollection, {
      where: {
        field: "nodeTag",
        op: "==",
        value: "appointment scheduled",
      },
      orderBy: { field: "timestamp", dir: "desc" },
      limit: 5_000,
    });

    // Latest "appointment scheduled" message per phone (in case of rebookings).
    type ApptMsg = { phone10: string; refIso: string; message: string };
    const latestByPhone = new Map<string, ApptMsg>();
    for (const e of apptMessages) {
      const m = e.data as unknown as ConversationMessage;
      const phone10 = String(m.phoneNumber ?? "");
      if (!phone10 || phone10.length !== 10) continue;
      const cur = latestByPhone.get(phone10);
      const ts = String(m.timestamp ?? "");
      if (!cur || cur.refIso < ts) {
        latestByPhone.set(phone10, {
          phone10,
          refIso: ts,
          message: String(m.message ?? ""),
        });
      }
    }

    // Per-phone history lookup. Replaces the 50k pre-load with one small
    // indexed query per candidate phone — total reads bounded by the
    // candidate set, which is typically a few hundred at most.
    async function phoneHasFiredInjection(phone10: string): Promise<boolean> {
      const matches = await db.list(injectionHistoryCollection, {
        where: { field: "phone", op: "==", value: phone10 },
        limit: 1,
      });
      return matches.length > 0;
    }

    const nowMs = Date.now();
    const created: Array<{ phone10: string; eventTime: string; from: string }> =
      [];
    const skipped: Array<
      { phone10: string; reason: string; eventTime?: string }
    > = [];

    for (const a of latestByPhone.values()) {
      const eventTime = parseAppointment(a.message, a.refIso);
      if (!eventTime) {
        skipped.push({
          phone10: a.phone10,
          reason: "could not parse appointment time",
        });
        continue;
      }
      const eventMs = new Date(eventTime).getTime();
      if (eventMs < nowMs) {
        skipped.push({
          phone10: a.phone10,
          reason: "appointment in the past",
          eventTime,
        });
        continue;
      }
      const existingPending = await db.get(
        scheduledInjectionDocPath(a.phone10),
      );
      if (existingPending) {
        skipped.push({
          phone10: a.phone10,
          reason: "already has pending scheduledinjection",
          eventTime,
        });
        continue;
      }
      if (await phoneHasFiredInjection(a.phone10)) {
        skipped.push({
          phone10: a.phone10,
          reason: "already fired in injectionhistory",
          eventTime,
        });
        continue;
      }
      if (dryRun) {
        created.push({
          phone10: a.phone10,
          eventTime,
          from: a.message.slice(0, 80),
        });
        continue;
      }
      await scheduleInjection(a.phone10, eventTime, false);
      created.push({
        phone10: a.phone10,
        eventTime,
        from: a.message.slice(0, 80),
      });
      console.log(
        `[repopulate-injections] ✅ ${a.phone10} eventTime=${eventTime}`,
      );
    }

    return Response.json({
      success: true,
      dryRun,
      apptMessagesScanned: latestByPhone.size,
      created: created.length,
      skipped: skipped.length,
      createdEntries: created,
      skippedEntries: skipped,
    });
  },
});
