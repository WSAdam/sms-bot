// Sale-match: given a list of phones from the Quickbase bookings report,
// match each against the latest scheduled-injection record. If the booking is
// within `windowDays` of when the injection was scheduled, mark a sale and
// activate the guest.

import { SALE_MATCH_WINDOW_DAYS } from "@shared/config/constants.ts";
import {
  guestActivatedDocPath,
  injectionHistoryCollection,
  salesOutsideWindowDocPath,
  salesWithin7dDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  ActivateFromReportSummary,
  SaleMatchReason,
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
  activator?: string; // QB activator field (e.g. "ODR - Rodger Gamble")
  office?: string; // QB "Activating Office" field (e.g. "ODR")
}

// ODR activations ALWAYS count as a sale regardless of the day-window check,
// as long as we have an appointment record on file for the phone. ODR shows
// up two ways in QB:
//   - "Activator" field starts with "ODR -" (e.g. "ODR - Rodger Gamble")
//   - "Activating Office" field is exactly "ODR"
// Either signal counts. Returns the reason so we can record provenance.
function odrReason(
  activator: string | undefined | null,
  office: string | undefined | null,
): "odr_activator" | "odr_office" | null {
  if (activator && activator.trim().toUpperCase().startsWith("ODR -")) {
    return "odr_activator";
  }
  if (office && office.trim().toUpperCase() === "ODR") return "odr_office";
  return null;
}

interface ApptCandidate {
  eventTime: string;
  eventTimeMs: number;
}

export interface ProcessSaleMatchOptions {
  verbose?: boolean; // include full skippedNoInjection list in response
}

export async function processSaleMatches(
  inputs: SaleMatchInput[],
  client: FirestoreClient = getFirestoreClient(),
  options: ProcessSaleMatchOptions = {},
): Promise<ActivateFromReportSummary> {
  const summary: ActivateFromReportSummary = {
    success: true,
    fetchedFromReport: inputs.length,
    matched: 0,
    matchedByOdr: 0,
    skippedNoInjection: 0,
    skippedOlderThan7Days: 0,
    matches: [],
    skippedInWindow: [],
    ...(options.verbose ? { skippedNoInjectionList: [] } : {}),
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

  // Collect all writes here and commit as one batch at the end. With report
  // 678 we can have hundreds of matches × 2 writes each — sequential
  // client.set() calls easily blew past Deno Deploy's 60s request limit.
  // One Firestore batch.commit() is essentially a single round trip.
  const writes: BatchOp[] = [];

  for (const { phone10, saleAt, activator, office } of inputs) {
    if (phone10.length !== 10) {
      summary.skippedNoInjection++;
      summary.skippedNoInjectionList?.push({
        phone10,
        activatedAt: saleAt ?? "",
      });
      continue;
    }

    const saleMs = saleAt ? parseDateishToMs(saleAt) : Date.now();
    if (saleMs == null) {
      summary.skippedNoInjection++;
      summary.skippedNoInjectionList?.push({
        phone10,
        activatedAt: saleAt ?? "",
      });
      continue;
    }

    const candidates = apptMap.get(phone10) ?? [];
    const odrKind = odrReason(activator, office);

    // Pick the closest in-window candidate (if any). Day-level diff in ET so
    // a same-day activation doesn't false-reject.
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

    const saleDay = easternDateString(new Date(saleMs));
    const apptSummary = candidates
      .slice(0, 5)
      .map((c) =>
        `${easternDateString(new Date(c.eventTimeMs))}(d=${dayDiff(c.eventTimeMs, saleMs)})`
      )
      .join(",");

    // Decision tree:
    //   1. In-window appointment match → write as "within_window"
    //   2. ODR activator AND we have AT LEAST ONE appointment for them →
    //      write as "odr_activator" even if outside the 8-day window.
    //      The phone MUST have a scheduled-injection record (we sent them
    //      through our SMS funnel). ODR activations of phones we never
    //      touched do NOT count — that's just ODR doing their other work.
    //   3. Has appointment(s) but none in window AND non-ODR → skippedOlderThan7Days
    //   4. No appointments → skippedNoInjection (silent, regardless of ODR)
    let appointmentAt: string | null;
    let withinDays: number | null;
    let matchReason: SaleMatchReason;

    if (best) {
      appointmentAt = best.eventTime;
      withinDays = bestWithinDays;
      matchReason = "within_window";
      console.log(
        `[sale-match] ✅ ${phone10} sale=${saleDay} appts=[${apptSummary}] → matched ${easternDateString(new Date(best.eventTimeMs))} (${bestWithinDays}d)`,
      );
    } else if (candidates.length === 0) {
      // No appointment record — skip even if ODR activated. We can't claim
      // credit for an ODR activation if we never sent them an SMS.
      summary.skippedNoInjection++;
      summary.skippedNoInjectionList?.push({
        phone10,
        activatedAt: new Date(saleMs).toISOString(),
      });
      continue;
    } else if (odrKind) {
      // Has appointment(s) but outside the 8d window AND ODR (by activator
      // or activating office) → count.
      const ref = candidates.slice().sort((a, b) =>
        Math.abs(dayDiff(a.eventTimeMs, saleMs)) -
        Math.abs(dayDiff(b.eventTimeMs, saleMs))
      )[0];
      appointmentAt = ref.eventTime;
      withinDays = dayDiff(ref.eventTimeMs, saleMs);
      matchReason = odrKind;
      console.log(
        `[sale-match] ✅ ${phone10} sale=${saleDay} appts=[${apptSummary}] activator="${activator ?? ""}" office="${office ?? ""}" → matched (${odrKind}, ${withinDays}d)`,
      );
    } else {
      console.log(
        `[sale-match] ⏭ ${phone10} sale=${saleDay} appts=[${apptSummary}] activator="${activator ?? ""}" office="${office ?? ""}" → outside ${SALE_MATCH_WINDOW_DAYS}d window`,
      );
      summary.skippedOlderThan7Days++;
      const candidateDetails = candidates.map((c) => ({
        appointmentAt: c.eventTime,
        daysDiff: dayDiff(c.eventTimeMs, saleMs),
      }));
      summary.skippedInWindow.push({
        phone10,
        activatedAt: new Date(saleMs).toISOString(),
        candidates: candidateDetails,
      });
      const closest = candidateDetails.slice().sort((a, b) =>
        Math.abs(a.daysDiff) - Math.abs(b.daysDiff)
      )[0];
      writes.push({
        type: "set",
        path: salesOutsideWindowDocPath(phone10),
        data: {
          phone10,
          activatedAt: new Date(saleMs).toISOString(),
          closestAppointmentAt: closest?.appointmentAt ?? null,
          closestDaysDiff: closest?.daysDiff ?? null,
          candidates: candidateDetails,
          activator: activator ?? null,
          office: office ?? null,
          windowDays: SALE_MATCH_WINDOW_DAYS,
          updatedAt: new Date().toISOString(),
        },
      });
      continue;
    }

    const updatedAt = new Date().toISOString();
    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt,
      saleAt: new Date(saleMs).toISOString(),
      windowDays: SALE_MATCH_WINDOW_DAYS,
      withinDays,
      matchReason,
      ...(activator ? { activator } : {}),
      ...(office ? { office } : {}),
      updatedAt,
    };
    writes.push({
      type: "set",
      path: salesWithin7dDocPath(phone10),
      data: marker as unknown as Record<string, unknown>,
    });
    writes.push({
      type: "set",
      path: guestActivatedDocPath(phone10),
      data: {
        phone10,
        Activated: true,
        activatedAt: updatedAt,
        eventTime: appointmentAt,
        matchReason,
        ...(activator ? { activator } : {}),
        ...(office ? { office } : {}),
      },
    });
    // If this phone was previously parked in salesoutsidewindow (e.g. earlier
    // run before we knew about the office field), clean that up so the drill-in
    // doesn't keep showing it as a near-miss after we've now counted it.
    writes.push({
      type: "delete",
      path: salesOutsideWindowDocPath(phone10),
    });

    summary.matched++;
    if (matchReason === "odr_activator" || matchReason === "odr_office") {
      summary.matchedByOdr++;
    }
    summary.matches.push({
      phone10,
      appointmentAt,
      activatedAt: marker.saleAt,
      withinDays,
      matchReason,
      ...(activator ? { activator } : {}),
      ...(office ? { office } : {}),
    });
  }

  // Single batched commit for ALL writes (matches + outside-window). The
  // wrapper auto-chunks at 400 ops per Firestore batch, so we don't need
  // to slice manually.
  if (writes.length > 0) {
    console.log(`[sale-match] committing ${writes.length} writes in batch...`);
    await client.batch(writes);
  }

  return summary;
}
