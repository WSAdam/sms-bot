// Sale-match: given a list of phones from the Quickbase bookings report,
// match each against the latest scheduled-injection record. If the booking is
// within `windowDays` of when the injection was scheduled, mark a sale and
// activate the guest.

import { SALE_MATCH_WINDOW_DAYS } from "@shared/config/constants.ts";
import {
  guestActivatedDocPath,
  injectionHistoryCollection,
  salesWithin7dDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  ActivateFromReportSummary,
  SaleWithinWindowMarker,
} from "@shared/types/sale.ts";
import {
  dayDiff,
  easternDateString,
  isWithinDayWindow,
  parseDateishToMs,
} from "@shared/util/time.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export interface SaleMatchInput {
  phone10: string;
  saleAt?: string; // when the sale was recorded (defaults to now)
}

interface ApptCandidate {
  eventTime: string;
  eventTimeMs: number;
}

export async function processSaleMatches(
  inputs: SaleMatchInput[],
  client: FirestoreClient = getFirestoreClient(),
): Promise<ActivateFromReportSummary> {
  const summary: ActivateFromReportSummary = {
    success: true,
    fetchedFromReport: inputs.length,
    matched: 0,
    skippedNoInjection: 0,
    skippedOlderThan7Days: 0,
    matches: [],
  };

  // Bulk-load every known appointment for every phone — both pending
  // (scheduledinjections, deleted on fire) and historical (injectionhistory,
  // append-only). A phone can appear multiple times across rebookings, so we
  // collect every eventTime we know about and pick the best one per match.
  const [pendingDocs, historyDocs] = await Promise.all([
    client.list(scheduledInjectionsCollection, { limit: 50_000 }),
    client.list(injectionHistoryCollection, { limit: 50_000 }),
  ]);

  const apptMap = new Map<string, ApptCandidate[]>();
  function add(rawPhone: unknown, rawEventTime: unknown) {
    if (typeof rawPhone !== "string" || typeof rawEventTime !== "string") return;
    const phone10 = normalizePhone(rawPhone);
    if (!phone10) return;
    const ms = parseDateishToMs(rawEventTime);
    if (ms == null) return;
    const arr = apptMap.get(phone10) ?? [];
    arr.push({ eventTime: rawEventTime, eventTimeMs: ms });
    apptMap.set(phone10, arr);
  }
  for (const e of pendingDocs) {
    const d = e.data as Record<string, unknown>;
    add(d.phone, d.eventTime);
  }
  for (const e of historyDocs) {
    const d = e.data as Record<string, unknown>;
    add(d.phone, d.eventTime);
  }
  console.log(
    `[sale-match] loaded ${pendingDocs.length} pending + ${historyDocs.length} history = ${apptMap.size} unique phones with appointments`,
  );

  for (const { phone10, saleAt } of inputs) {
    if (phone10.length !== 10) {
      summary.skippedNoInjection++;
      continue;
    }

    const candidates = apptMap.get(phone10);
    if (!candidates || candidates.length === 0) {
      summary.skippedNoInjection++;
      continue;
    }

    const saleMs = saleAt ? parseDateishToMs(saleAt) : Date.now();
    if (saleMs == null) {
      summary.skippedNoInjection++;
      continue;
    }

    // Pick the candidate that matches the day-level window. We compare
    // calendar days in ET, not raw timestamps, so a same-day activation
    // doesn't false-reject when the appointment is later in the day than
    // midnight-UTC of the activation date.
    let best: ApptCandidate | null = null;
    let bestWithinDays = Infinity;
    for (const c of candidates) {
      if (!isWithinDayWindow(c.eventTimeMs, saleMs, SALE_MATCH_WINDOW_DAYS)) {
        continue;
      }
      const d = dayDiff(c.eventTimeMs, saleMs);
      if (d >= 0 && d < bestWithinDays) {
        best = c;
        bestWithinDays = d;
      }
    }

    // Detailed per-phone log — only fires for phones that actually have
    // appointment records (~hundreds at scale, not the full QB report).
    // Lets you eyeball whether a near-miss should have matched.
    const saleDay = easternDateString(new Date(saleMs));
    const apptSummary = candidates
      .slice(0, 5)
      .map((c) => `${easternDateString(new Date(c.eventTimeMs))}(d=${dayDiff(c.eventTimeMs, saleMs)})`)
      .join(",");
    if (best) {
      console.log(
        `[sale-match] ✅ ${phone10} sale=${saleDay} appts=[${apptSummary}] → matched ${easternDateString(new Date(best.eventTimeMs))} (${bestWithinDays}d)`,
      );
    } else {
      console.log(
        `[sale-match] ⏭ ${phone10} sale=${saleDay} appts=[${apptSummary}] → outside ${SALE_MATCH_WINDOW_DAYS}d window`,
      );
      summary.skippedOlderThan7Days++;
      continue;
    }

    const updatedAt = new Date().toISOString();
    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt: best.eventTime,
      saleAt: new Date(saleMs).toISOString(),
      windowDays: SALE_MATCH_WINDOW_DAYS,
      withinDays: bestWithinDays,
      updatedAt,
    };
    await client.set(
      salesWithin7dDocPath(phone10),
      marker as unknown as Record<string, unknown>,
    );
    await client.set(guestActivatedDocPath(phone10), {
      phone10,
      Activated: true,
      activatedAt: updatedAt,
      eventTime: best.eventTime,
    });

    summary.matched++;
    summary.matches.push({
      phone10,
      appointmentAt: best.eventTime,
      withinDays: bestWithinDays,
    });
  }

  return summary;
}
