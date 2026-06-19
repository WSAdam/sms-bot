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

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  guestActivatedDocPath,
  injectionHistoryCollection,
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import * as bland from "@messaging/domain/data/bland/mod.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import { injectionHistoryDocId } from "@shared/util/id.ts";
import { normalizeAppointmentTime } from "@shared/util/time.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";

// Synthetic conversation callIds — written by cal.com / appointment-booked /
// prior booking-scan recovery — start with `appt_`. They contain bot
// confirmation messages (e.g. "Appointment Scheduled: May 19, 9:00 AM")
// that the booking-scan parser would happily re-interpret as fresh
// signals. Re-parsing our own output produces duplicate proposals and,
// worse, the time-only fallback drift bug observed 2026-05-25. Filter
// them out at the source — booking-scan only consumes real Bland
// conversation callIds (UUIDs).
function isSyntheticCallId(callId: string): boolean {
  return callId.startsWith("appt_");
}

// Past-eventTime tolerance for proposals. Anything older than this is
// dropped (counted as `skippedPast`). 24h gives recovery a wide window
// for genuinely-just-missed appointments without re-injecting week-old
// stale slots. The 72h sweep dedup catches anything that slipped past
// this and was already dialed, so this is the *front-line* filter.
const PROPOSAL_PAST_TOLERANCE_MS = 24 * 60 * 60 * 1000;

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

interface BlandMsg {
  sender?: string;
  message?: string;
  created_at?: string;
}

export interface BookingProposal {
  phone10: string;
  callId: string;
  signal:
    | "locked_in"
    | "tag_appointment_scheduled"
    | "text_appointment_scheduled";
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
  // Conversations whose callId is a synthetic `appt_*` id (written by
  // cal.com / appointment-booked / prior recovery). Dropped at the
  // group-by stage before signal detection.
  skippedSyntheticAppt: number;
  // Proposals whose derived eventTime is more than 24h in the past.
  // Dropped from the proposals list; no dial would have ever been
  // useful.
  skippedPast: number;
  errored: number;
  proposals: BookingProposal[];
  errors: string[];
  // Per-conversation outcome trace. Populated for every conversation
  // the scan saw — including ones with no signal — so the operator can
  // pinpoint why a specific phone wasn't proposed. Capped at 2000
  // entries to keep the response size sane on long-window scans.
  outcomes?: BookingScanOutcome[];
}

export interface BookingScanOutcome {
  phone10: string;
  callId: string;
  messageCount: number;
  // What happened to this conversation:
  // - "skipped-synthetic-appt" — callId starts with `appt_` (bot-written
  //   confirmation, not a real Bland conversation). Filtered before
  //   signal detection to prevent re-parsing of our own output.
  // - "skipped-excluded"       — phone is in EXCLUDED_REPORTING_PHONES
  // - "skipped-already-recovered" — prior booking-scan run already
  //   wrote an injectionhistory doc for this callId
  // - "skipped-activated"      — phone already has a guestactivated doc
  // - "skipped-pending"        — phone has a pending scheduledinjection
  // - "skipped-past"           — eventTime is > 24h before now; no dial
  //   would have ever been useful.
  // - "no-signal"              — conversation processed but no "locked in"
  //   / "Appointment Scheduled" message detected
  // - "proposed"               — signal detected, proposal added to the
  //   proposals array
  outcome:
    | "skipped-synthetic-appt"
    | "skipped-excluded"
    | "skipped-already-recovered"
    | "skipped-activated"
    | "skipped-pending"
    | "skipped-past"
    | "no-signal"
    | "proposed";
  signal?: BookingProposal["signal"];
  eventTime?: string | null;
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
    const iso = `${year}-${String(monthIdx + 1).padStart(2, "0")}-${
      String(parseInt(dayStr, 10)).padStart(2, "0")
    }T${String(h).padStart(2, "0")}:${
      String(minute).padStart(2, "0")
    }:00-04:00`;
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

// `senderIsGuest` accepts both Bland's "USER"/"ASSISTANT" enum (from
// live API responses) and Firestore's "Guest"/"AI Bot" enum (stored
// on every conversation message). The new Firestore-driven scan path
// passes the latter; the kept-for-fallback Bland API call path used to
// pass the former. Booking signals come from the bot — we return false
// when the message is from the customer.
function senderIsGuest(s: string | undefined): boolean {
  const u = (s ?? "").toUpperCase();
  return u === "USER" || u === "GUEST";
}

function detectSignal(
  msgs: BlandMsg[],
  idx: number,
):
  | { signal: BookingProposal["signal"]; signalAt: string }
  | null {
  const m = msgs[idx];
  if (!m) return null;
  if (senderIsGuest(m.sender)) return null;
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
  force: boolean = false,
): Promise<BookingScanSummary> {
  const db = getFirestoreClient();
  // Pre-fix this called bland.listConversationsByDateRange + one
  // bland.getConversation(callId) PER conversation — 1,200 sequential
  // Bland API calls for a 30-day window, ~10 min wall time, 503s on
  // Deno Deploy. Now: one Firestore list of messages in the window,
  // grouped by (phoneNumber, callId) in memory. Zero Bland calls for
  // signal detection. Bland is only contacted later, and ONLY for
  // conversations with a detected signal — to fetch the structured
  // variables.Desired_Time field (still the highest-confidence
  // appointment time source — see comment near getBlandDesiredTime
  // call below). Net: ~50-100 Bland calls instead of 1,200.
  //
  // Single-field auto-index on `timestamp` covers this query; the
  // `<= toIso` upper bound is enforced client-side on the bounded
  // slice.
  const messages = await db.list(conversationsCollection, {
    where: { field: "timestamp", op: ">=", value: fromIso },
    orderBy: { field: "timestamp", dir: "asc" },
    limit: 50_000,
  });

  // Group by (phoneNumber, callId) so each iteration of the main loop
  // gets a full conversation message list — same shape detectSignal /
  // parseDateFromText expect. We drop messages outside the upper window
  // bound here, AND we drop any group whose callId is a synthetic
  // `appt_*` id (bot-written confirmation, not a real Bland convo —
  // re-parsing produces duplicates + wrong dates).
  const byConvo = new Map<string, ConversationMessage[]>();
  let droppedSynthetic = 0;
  for (const e of messages) {
    const m = e.data as unknown as ConversationMessage;
    if (!m.phoneNumber || !m.callId) continue;
    if (toIso && (m.timestamp ?? "") > toIso) continue;
    if (isSyntheticCallId(m.callId)) {
      droppedSynthetic++;
      continue;
    }
    const key = `${m.phoneNumber}__${m.callId}`;
    const arr = byConvo.get(key) ?? [];
    arr.push(m);
    byConvo.set(key, arr);
  }

  console.log(
    `[booking-scan] Firestore returned ${messages.length} messages across ${byConvo.size} conversations for ${fromIso} → ${
      toIso ?? "now"
    }`,
  );

  const summary: BookingScanSummary = {
    fromIso,
    toIso: toIso ?? null,
    // Keep field name for backwards-compat with the response shape
    // /test page renders. Same meaning post-refactor (count of distinct
    // real Bland conversations in the window — synthetic `appt_*`
    // groups are excluded).
    blandConversations: byConvo.size,
    proposed: 0,
    applied: 0,
    skippedExisting: 0,
    skippedNoTime: 0,
    skippedSyntheticAppt: droppedSynthetic,
    skippedPast: 0,
    errored: 0,
    proposals: [],
    errors: [],
    outcomes: [],
  };
  const OUTCOMES_CAP = 2_000;
  function trace(o: BookingScanOutcome): void {
    if (summary.outcomes && summary.outcomes.length < OUTCOMES_CAP) {
      summary.outcomes.push(o);
    }
  }

  let processed = 0;
  for (const [key, convoMessages] of byConvo) {
    processed++;
    const sep = key.indexOf("__");
    const phone10 = sep > 0 ? key.slice(0, sep) : "";
    const callId = sep > 0 ? key.slice(sep + 2) : "";
    if (!phone10 || phone10.length !== 10 || !callId) continue;

    // Test/excluded phones (Adam's, Edwin's, etc.) must never get a real
    // scheduledinjection — the cron sweep would fire the dialer at the
    // operator. Skip BEFORE any write/read.
    if (isExcludedFromReporting(phone10)) {
      summary.skippedExisting++;
      trace({
        phone10,
        callId,
        messageCount: convoMessages.length,
        outcome: "skipped-excluded",
      });
      console.log(
        `[booking-scan] [${processed}/${byConvo.size}] ${phone10}  skipped (excluded test phone)`,
      );
      continue;
    }

    // Per-conversation lookup: has this callId already been recovered?
    // Indexed where(recoveredFromCallId == callId) — typically 0 docs,
    // 1 if a prior scan recovered it. Same guard that prevents this
    // refactor from re-processing the same callId twice.
    const priorRecoveryMatches = await db.list(injectionHistoryCollection, {
      where: { field: "recoveredFromCallId", op: "==", value: callId },
      limit: 1,
    });
    const existingRecoveryDocId = priorRecoveryMatches[0]?.id;
    if (existingRecoveryDocId && !force) {
      summary.skippedExisting++;
      trace({
        phone10,
        callId,
        messageCount: convoMessages.length,
        outcome: "skipped-already-recovered",
      });
      console.log(
        `[booking-scan] [${processed}/${byConvo.size}] ${phone10}  skipped (already recovered)`,
      );
      continue;
    }
    // Phone is already a credited sale — booking-scan has no business
    // reprocessing their booking conversation. Force=true still skips
    // because re-parsing won't change the credited record either.
    const activatedDoc = await db.get(guestActivatedDocPath(phone10));
    if (activatedDoc) {
      summary.skippedExisting++;
      trace({
        phone10,
        callId,
        messageCount: convoMessages.length,
        outcome: "skipped-activated",
      });
      console.log(
        `[booking-scan] [${processed}/${byConvo.size}] ${phone10}  skipped (already activated)`,
      );
      continue;
    }
    // Also skip if there's already a pending scheduledinjection — the
    // proper Cal.com path or a previous scan run already wrote one and
    // the sweep is going to handle it.
    const existingPending = await db.get(scheduledInjectionDocPath(phone10));
    if (existingPending && !force) {
      summary.skippedExisting++;
      trace({
        phone10,
        callId,
        messageCount: convoMessages.length,
        outcome: "skipped-pending",
      });
      console.log(
        `[booking-scan] [${processed}/${byConvo.size}] ${phone10}  skipped (already pending)`,
      );
      continue;
    }

    // Map Firestore conversation messages into the BlandMsg shape the
    // signal-detection + time-parsing functions below expect. No Bland
    // API call here — every field we need (sender, message, timestamp)
    // is already on the Firestore doc.
    const msgs: BlandMsg[] = convoMessages
      .map((m) => ({
        sender: m.sender,
        message: m.message,
        created_at: m.timestamp,
      }))
      .filter((m) => m.message && m.message !== "<Call Connected>");
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
    if (!signalInfo || signalIdx < 0) {
      trace({
        phone10,
        callId,
        messageCount: convoMessages.length,
        outcome: "no-signal",
      });
      continue;
    }

    // Bland's pathway already parsed the appointment time and stored it
    // structured as `variables.Desired_Time` — way more reliable than
    // re-parsing English from the message stream. We saw a case
    // (2195884368) where our regex turned "Tomorrow 9am" + "MST" into
    // 5/7 instead of 5/3; Bland had the right value with an explicit
    // -07:00 offset. So: try Bland FIRST, fall back to message parsing
    // only if Bland has nothing or the value fails sanity gates (±4h
    // past, +180d future of convo's now_utc — filters out stale
    // upstream lead-source defaults that come pre-populated).
    let eventTime: string | null = null;
    let eventTimeSource: string | null = null;
    let eventTimeIsFuture = false;

    const blandDt = await bland.getBlandDesiredTime(callId);
    if (blandDt) {
      // Bland normalizes at its boundary (getBlandDesiredTime). Re-running
      // here is a cheap defense-in-depth — any change to the upstream
      // pathway that re-introduces TZ-naive output gets caught here
      // instead of silently propagating.
      eventTime = normalizeAppointmentTime(blandDt.iso, undefined);
      eventTimeSource = blandDt.source;
    }

    // Fallback: walk backward looking for an explicit date+time match
    // (month + day + h:mm + AM/PM in a single message). parseDateFromText
    // emits ISO with `-04:00` so it's already canonical, but normalize
    // for symmetry with the Bland path.
    //
    // NOTE: The pre-2026-05-25 "time-only next-occurrence" fallback used
    // to live here. It re-anchored matches like "9:00 AM" to TODAY's
    // 9 AM regardless of the original message's date, which produced
    // the wrong-date proposals that caused the 5/25 incident. Deleted
    // intentionally — if we can't get a confident full date, we fall
    // through to the placeholder-injectionhistory path instead.
    if (!eventTime) {
      for (let i = signalIdx; i >= 0; i--) {
        const candidate = msgs[i];
        if (!candidate) continue;
        const parsed = parseDateFromText(
          candidate.message ?? "",
          candidate.created_at ?? signalInfo.signalAt,
        );
        if (parsed) {
          eventTime = normalizeAppointmentTime(parsed, undefined);
          const who = senderIsGuest(candidate.sender) ? "guest" : "bot";
          eventTimeSource = `[${who}] ${
            (candidate.message ?? "").slice(0, 80)
          }`;
          break;
        }
      }
    }

    // 24h past-tolerance front-line filter. Anything older than this
    // doesn't represent a usefully-dialable appointment, even if the
    // sweep's 72h dedup would catch any duplicate. We drop these from
    // the proposals list AND from the recovery-placeholder path.
    if (eventTime) {
      const eventMs = new Date(eventTime).getTime();
      if (
        Number.isFinite(eventMs) &&
        eventMs < Date.now() - PROPOSAL_PAST_TOLERANCE_MS
      ) {
        summary.skippedPast++;
        trace({
          phone10,
          callId,
          messageCount: convoMessages.length,
          outcome: "skipped-past",
          signal: signalInfo.signal,
          eventTime,
        });
        console.log(
          `[booking-scan] [${processed}/${byConvo.size}] ${phone10}  skipped (eventTime ${eventTime} is > 24h past)`,
        );
        continue;
      }
      if (eventMs > Date.now()) eventTimeIsFuture = true;
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
    trace({
      phone10,
      callId,
      messageCount: convoMessages.length,
      outcome: "proposed",
      signal: signalInfo.signal,
      eventTime,
    });

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
        `[booking-scan] [no-time placeholder] ${phone10}/${
          callId.slice(0, 8)
        } — convo:`,
      );
      for (const m of msgs) {
        const who = senderIsGuest(m.sender) ? "guest" : "bot";
        console.log(
          `    [${(m.created_at ?? "").slice(11, 19)}] ${who}: ${
            (m.message ?? "").slice(0, 140)
          }`,
        );
      }
    }
    if (apply) {
      try {
        // With --force, drop the stale recovery doc first so the dashboard
        // count doesn't double up (history-placeholder + new write).
        if (force && existingRecoveryDocId) {
          await db.delete(
            `${injectionHistoryCollection}/${existingRecoveryDocId}`,
          );
          console.log(
            `[booking-scan] [force] deleted stale recovery ${
              existingRecoveryDocId.slice(0, 30)
            }…`,
          );
        }
        if (eventTimeIsFuture && eventTime) {
          // Real future time — write a pending scheduledinjection so the
          // every-minute cron sweep fires the dialer at appointment time.
          await scheduleInjection(phone10, eventTime, false);
          summary.applied++;
          console.log(
            `[booking-scan] ✅ ${phone10} scheduledinjection eventTime=${eventTime} signal=${proposal.signal} via=${
              callId.slice(0, 8)
            }…`,
          );
        } else {
          // No parseable time OR time was in the past — record in history
          // as a placeholder so the booking COUNTS without risking a stale
          // sweep fire. Operator can manually claim or re-book.
          //
          // When we couldn't parse a real appointment time, `eventTime`
          // here is the bot-message timestamp (signalInfo.signalAt) —
          // NOT the actual scheduled call time. Tag the doc so downstream
          // (sale-match → guestactivated → dashboard column) can render
          // it as unknown instead of showing a misleading "appointment
          // time" that's really just our recovery cron's clock.
          const firedAt = signalInfo.signalAt;
          const docId = injectionHistoryDocId(phone10, firedAt);
          const isPlaceholderTime = !eventTime;
          await db.set(injectionHistoryDocPath(docId), {
            phone: phone10,
            eventTime: eventTimeFinal,
            eventTimePlaceholder: isPlaceholderTime,
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
            `[booking-scan] ✅ ${phone10} history-placeholder eventTime=${eventTimeFinal}${
              isPlaceholderTime ? " (unknown)" : ""
            } signal=${proposal.signal} via=${callId.slice(0, 8)}…`,
          );
        }
      } catch (e) {
        summary.errored++;
        summary.errors.push(`${phone10}: write ${(e as Error).message}`);
      }
    }
  }

  console.log(
    `[booking-scan] done — proposed=${summary.proposed} applied=${summary.applied} ` +
      `skippedExisting=${summary.skippedExisting} skippedNoTime=${summary.skippedNoTime} ` +
      `skippedSyntheticAppt=${summary.skippedSyntheticAppt} skippedPast=${summary.skippedPast} ` +
      `errored=${summary.errored}`,
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
  const toIso = new Date(new Date(fromIso).getTime() + 24 * 60 * 60 * 1000)
    .toISOString();
  return { fromIso, toIso };
}
