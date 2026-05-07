// Scan Bland conversations for booking-confirmation patterns and recover
// any appointment whose Cal.com webhook didn't fire (so no scheduledinjection
// doc exists). Used by:
//   - POST /api/admin/scan-bookings (manual trigger from test page)
//   - Nightly cron (chained after the conversation reseed)
//
// Detection logic — for each phone in the date range, walk its conversation
// timestamps in order and look for these signals (highest confidence first):
//   1. AI Bot message containing "locked in"  → strong "they booked" signal
//   2. AI Bot message with nodeTag "appointment scheduled"  → legacy tag
//   3. AI Bot message starting with "Appointment Scheduled:"  → legacy text
//
// When a signal hits, walk BACKWARD in the same conversation to find the most
// recent AI Bot message that mentions a date+time (e.g. "June 1, 9 AM"). If
// nothing parseable, the entry is surfaced for manual review with no
// proposed eventTime — we don't guess.
//
// Apply rules: skip phones that already have a pending scheduledinjection
// OR a fired injectionhistory doc. Idempotent — safe to re-run.

import {
  injectionHistoryCollection,
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import * as bland from "@shared/services/bland/client.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import { injectionHistoryDocId } from "@shared/util/id.ts";

const MONTHS: Record<string, number> = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

interface BlandMsg {
  sender?: string;
  message?: string;
  created_at?: string;
}

export interface BookingProposal {
  phone10: string;
  callId: string;
  signal: "locked_in" | "tag_appointment_scheduled" | "text_appointment_scheduled";
  signalAt: string;
  eventTime: string | null;
  eventTimeSource: string | null;
  reason?: string;
}

export interface BookingScanSummary {
  fromIso: string;
  toIso: string | null;
  blandConversations: number;
  proposed: number;
  applied: number;
  skippedExisting: number;
  skippedNoTime: number;
  errored: number;
  proposals: BookingProposal[];
  errors: string[];
}

// Match dates like "Jun 1, 9 AM", "June 1 at 9:00 AM", "Apr 30 3 PM" — a
// month name + day + (optional 'at') + h:mm or h + AM/PM.
const DATE_RE =
  /\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:[a-z]{0,3})?(?:\s+at)?\s+(\d{1,2})(?::(\d{2}))?\s*(AM|PM|a\.?m\.?|p\.?m\.?)/i;

function parseDateFromText(text: string, refIso: string): string | null {
  const m = text.match(DATE_RE);
  if (!m) return null;
  const [, monStr, dayStr, hourStr, minuteStr, ampmRaw] = m;
  const monthIdx = MONTHS[monStr.toLowerCase().slice(0, 3)];
  if (monthIdx == null) return null;
  let h = parseInt(hourStr, 10);
  const minute = minuteStr ? parseInt(minuteStr, 10) : 0;
  const ampm = ampmRaw.toUpperCase().replace(/\./g, "").replace(/M$/, "M");
  if (ampm.startsWith("P") && h < 12) h += 12;
  if (ampm.startsWith("A") && h === 12) h = 0;
  const refDate = new Date(refIso);
  if (!Number.isFinite(refDate.getTime())) return null;
  for (const yearOffset of [0, 1]) {
    const year = refDate.getUTCFullYear() + yearOffset;
    // Build the ISO assuming ET (-04:00 EDT). EST (-05:00) edge cases drift
    // by 1 hour but are good enough for cron sweep targeting.
    const iso =
      `${year}-${String(monthIdx + 1).padStart(2, "0")}-${String(parseInt(dayStr, 10)).padStart(2, "0")}T${String(h).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00-04:00`;
    const dt = new Date(iso);
    if (!Number.isFinite(dt.getTime())) continue;
    // Allow up to 12 h before signal time (for late-evening bookings into
    // the next morning that may be flagged by a small clock skew).
    if (dt.getTime() >= refDate.getTime() - 12 * 60 * 60 * 1000) {
      return dt.toISOString();
    }
  }
  return null;
}

function detectSignal(
  msgs: BlandMsg[],
  idx: number,
):
  | { signal: BookingProposal["signal"]; signalAt: string }
  | null {
  const m = msgs[idx];
  if (!m) return null;
  const sender = (m.sender ?? "").toUpperCase();
  // Bland's API uses USER for guest, ASSISTANT (or anything else) for bot.
  // Booking confirmations come from the bot.
  if (sender === "USER") return null;
  const text = m.message ?? "";
  const ts = m.created_at ?? new Date().toISOString();
  if (/locked\s+in/i.test(text)) return { signal: "locked_in", signalAt: ts };
  if (/^appointment\s+scheduled/i.test(text)) {
    return { signal: "text_appointment_scheduled", signalAt: ts };
  }
  return null;
}

export async function scanConversationsForBookings(
  fromIso: string,
  toIso: string | undefined,
  apply: boolean,
): Promise<BookingScanSummary> {
  const db = getFirestoreClient();
  // Pre-load (phone, callId) pairs we've already recovered via this scan,
  // so re-runs are idempotent. Cron-fired injections (firedBy="cron") and
  // manual fires don't block recovery — multiple bookings per phone over
  // time are real and shouldn't be collapsed.
  const history = await db.list(injectionHistoryCollection, { limit: 50_000 });
  const recoveredCallIds = new Set<string>();
  for (const e of history) {
    const data = e.data as Record<string, unknown>;
    if (data.firedBy === "booking-scan-recovery" && typeof data.recoveredFromCallId === "string") {
      recoveredCallIds.add(data.recoveredFromCallId);
    }
  }

  const list = await bland.listConversationsByDateRange(fromIso, toIso);
  console.log(
    `[booking-scan] Bland returned ${list.conversations.length} conversations for ${fromIso} → ${toIso ?? "now"}`,
  );

  const summary: BookingScanSummary = {
    fromIso,
    toIso: toIso ?? null,
    blandConversations: list.conversations.length,
    proposed: 0,
    applied: 0,
    skippedExisting: 0,
    skippedNoTime: 0,
    errored: 0,
    proposals: [],
    errors: [],
  };

  let processed = 0;
  for (const c of list.conversations) {
    processed++;
    const phoneRaw = String(c.user_number ?? "").replace(/\D/g, "");
    const phone10 = phoneRaw.length >= 10 ? phoneRaw.slice(-10) : phoneRaw;
    const callId = c.id;
    if (!phone10 || phone10.length !== 10 || !callId) continue;

    if (recoveredCallIds.has(callId)) {
      summary.skippedExisting++;
      console.log(
        `[booking-scan] [${processed}/${list.conversations.length}] ${phone10}  skipped (already recovered)`,
      );
      continue;
    }
    console.log(
      `[booking-scan] [${processed}/${list.conversations.length}] ${phone10}  fetching ${callId.slice(0, 8)}…`,
    );

    let r;
    try {
      r = await bland.getConversation(callId);
    } catch (e) {
      summary.errored++;
      summary.errors.push(`${phone10}/${callId}: ${(e as Error).message}`);
      continue;
    }
    if (!r.ok || !r.json.data) {
      summary.errored++;
      summary.errors.push(
        `${phone10}/${callId}: Bland ${r.status} ${JSON.stringify(r.json.errors ?? "").slice(0, 100)}`,
      );
      continue;
    }
    const msgs = (r.json.data.messages ?? []).filter((m: BlandMsg) =>
      m.message && m.message !== "<Call Connected>"
    ) as BlandMsg[];
    msgs.sort((a, b) => (a.created_at ?? "") < (b.created_at ?? "") ? -1 : 1);

    // Find the FIRST signal (in conversation order) — earliest booking
    // confirmation wins, since the customer can't book twice on the same call.
    let signalIdx = -1;
    let signalInfo: ReturnType<typeof detectSignal> = null;
    for (let i = 0; i < msgs.length; i++) {
      const s = detectSignal(msgs, i);
      if (s) {
        signalIdx = i;
        signalInfo = s;
        break;
      }
    }
    if (!signalInfo || signalIdx < 0) continue;

    // Walk backward through the FULL conversation looking for a date+time
    // in any message — bot OR user. The new Bland pathway often confirms
    // bookings with "You're locked in!" alone, leaving the negotiated time
    // in earlier messages (often the customer's own reply).
    let eventTime: string | null = null;
    let eventTimeSource: string | null = null;
    for (let i = signalIdx; i >= 0; i--) {
      const candidate = msgs[i];
      if (!candidate) continue;
      const parsed = parseDateFromText(
        candidate.message ?? "",
        candidate.created_at ?? signalInfo.signalAt,
      );
      if (parsed) {
        eventTime = parsed;
        const who = (candidate.sender ?? "").toUpperCase() === "USER"
          ? "guest"
          : "bot";
        eventTimeSource = `[${who}] ${(candidate.message ?? "").slice(0, 80)}`;
        break;
      }
    }

    const proposal: BookingProposal = {
      phone10,
      callId,
      signal: signalInfo.signal,
      signalAt: signalInfo.signalAt,
      eventTime,
      eventTimeSource,
      reason: eventTime ? undefined : "no parseable date in any prior message",
    };
    summary.proposals.push(proposal);
    summary.proposed++;

    // Recovery write: when "locked in" hits, the booking is real even if
    // we can't parse the exact time. Cal.com knows the actual time but
    // didn't fire its webhook to us, so we'll never know it. Write to
    // injectionhistory (NOT scheduledinjections) — that records the
    // booking for the dashboard count without risking a wrong-time fire
    // by the cron sweep.
    const eventTimeFinal = eventTime ?? signalInfo.signalAt;
    if (!eventTime) {
      summary.skippedNoTime++;
      // Still log the convo for visibility — useful when auditing why
      // a booking was recovered with a placeholder eventTime.
      console.log(
        `[booking-scan] [no-time placeholder] ${phone10}/${callId.slice(0, 8)} — convo:`,
      );
      for (const m of msgs) {
        const who = (m.sender ?? "").toUpperCase() === "USER" ? "guest" : "bot";
        console.log(
          `    [${(m.created_at ?? "").slice(11, 19)}] ${who}: ${(m.message ?? "").slice(0, 140)}`,
        );
      }
    }
    if (apply) {
      try {
        const firedAt = signalInfo.signalAt;
        const docId = injectionHistoryDocId(phone10, firedAt);
        await db.set(injectionHistoryDocPath(docId), {
          phone: phone10,
          eventTime: eventTimeFinal,
          scheduledAt: new Date(firedAt).getTime(),
          isTest: false,
          firedAt,
          firedBy: "booking-scan-recovery",
          status: "recovered",
          recoveredFromCallId: callId,
          recoveredSignal: signalInfo.signal,
          recoveredEventTimeSource: eventTimeSource,
        });
        summary.applied++;
        console.log(
          `[booking-scan] ✅ ${phone10} eventTime=${eventTimeFinal}${eventTime ? "" : " (placeholder)"} signal=${proposal.signal} via=${callId.slice(0, 8)}…`,
        );
      } catch (e) {
        summary.errored++;
        summary.errors.push(`${phone10}: history write ${(e as Error).message}`);
      }
    }
  }

  console.log(
    `[booking-scan] done — proposed=${summary.proposed} applied=${summary.applied} skippedExisting=${summary.skippedExisting} skippedNoTime=${summary.skippedNoTime} errored=${summary.errored}`,
  );
  return summary;
}

// Convenience: yesterday in ET as a wide UTC window. Mirrors the helper in
// reseed.ts so cron callers pass the same window to both.
export function yesterdayEasternRange(): { fromIso: string; toIso: string } {
  const now = new Date();
  const etDateString = now.toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
  const [y, m, d] = etDateString.split("-").map((s) => parseInt(s, 10));
  const yesterday = new Date(Date.UTC(y, m - 1, d));
  yesterday.setUTCDate(yesterday.getUTCDate() - 1);
  const yy = yesterday.getUTCFullYear();
  const mm = String(yesterday.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(yesterday.getUTCDate()).padStart(2, "0");
  const fromIso = `${yy}-${mm}-${dd}T05:00:00.000Z`;
  const toIso =
    new Date(new Date(fromIso).getTime() + 24 * 60 * 60 * 1000).toISOString();
  return { fromIso, toIso };
}
