// Sale-match: given a list of phones from the Quickbase bookings report,
// match each against the latest scheduled-injection record. If the booking is
// within `windowDays` of when the injection was scheduled, mark a sale and
// activate the guest.

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import {
  guestActivatedDocPath,
  guestAnsweredDocPath,
  injectionHistoryCollection,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  salesOutsideWindowDocPath,
  salesWithin7dDocPath,
  scheduledInjectionDocPath,
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
): "odr_activator" | "odr_office" | "second_chance_activator" | null {
  if (activator && activator.trim().toUpperCase().startsWith("ODR -")) {
    return "odr_activator";
  }
  // 2nd Chance leads share the dialer with ODR — a 2ND TM closing them is
  // operationally equivalent to an ODR TM closing, so the same window-bypass
  // rule applies. Distinct matchReason for analytics.
  if (activator && activator.trim().toUpperCase().startsWith("2ND -")) {
    return "second_chance_activator";
  }
  if (office && office.trim().toUpperCase() === "ODR") return "odr_office";
  return null;
}

interface ApptCandidate {
  eventTime: string;
  eventTimeMs: number;
  // True when this came from a booking-scan-recovery injectionhistory
  // record whose eventTime is a placeholder (the bot-message timestamp,
  // not a real appointment time). Propagated onto guestactivated so the
  // dashboard renders "(no time recorded)" instead of a misleading
  // pseudo-appointment.
  placeholderTime: boolean;
}

export interface ProcessSaleMatchOptions {
  verbose?: boolean; // include full skippedNoInjection list in response
}

export async function processSaleMatches(
  inputs: SaleMatchInput[],
  client: FirestoreClient = getFirestoreClient(),
  options: ProcessSaleMatchOptions = {},
): Promise<ActivateFromReportSummary> {
  // Read the live window from gatesConfig (dashboard-editable). Falls
  // back to windowDaysConfigured constant inside the gates-config
  // layer if Firestore is empty. One read, used for every input row.
  const { saleMatchWindowDays: windowDaysConfigured } = await getGatesConfig(
    client,
  );
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

  // Per-phone lookups instead of full-table pre-loads. For each row in
  // the QB report (~100-200 rows/day), we do up to 3 small reads: pending
  // injection (get), history list (where(phone) — typically 0-2 docs),
  // activated marker (get). Pre-fix this scanned 3 × 50_000 docs every
  // morning regardless of report size. See firestore-safety.md.
  //
  // CRITICAL: pre-load all unique phones IN PARALLEL (chunks of
  // LOOKUP_CONCURRENCY) and stash results in a map before the main loop.
  // The naive "await loadCandidatesAndActivated(phone) inside the for-
  // loop" pattern was sequential — 100 rows × ~150ms RTT = 15s of pure
  // Firestore latency, on top of QB + writes. With a 200-row report on
  // Deno Deploy that pushed past the request budget and surfaced as a
  // BOOT_FAILED 502 to the caller.
  const LOOKUP_CONCURRENCY = 20;

  async function loadOne(
    phone10: string,
  ): Promise<{ candidates: ApptCandidate[]; alreadyActivated: boolean }> {
    const [pendingDoc, historyDocs, activatedDoc] = await Promise.all([
      client.get(scheduledInjectionDocPath(phone10)),
      client.list(injectionHistoryCollection, {
        where: { field: "phone", op: "==", value: phone10 },
      }),
      client.get(guestActivatedDocPath(phone10)),
    ]);
    const out: ApptCandidate[] = [];
    function consider(
      rawEventTime: unknown,
      placeholderTime: boolean,
    ): void {
      if (typeof rawEventTime !== "string") return;
      const ms = parseDateishToMs(rawEventTime);
      if (ms == null) return;
      out.push({ eventTime: rawEventTime, eventTimeMs: ms, placeholderTime });
    }
    if (pendingDoc) {
      consider(pendingDoc.eventTime, false);
    }
    for (const e of historyDocs) {
      const d = e.data as Record<string, unknown>;
      consider(d.eventTime, d.eventTimePlaceholder === true);
    }
    return { candidates: out, alreadyActivated: activatedDoc !== null };
  }

  // Pre-fetch all unique phones in parallel chunks. For 100 rows at
  // concurrency 20, that's 5 sequential round-trips of 20 parallel
  // requests each — roughly 5 × ~150ms = ~750ms total instead of 15s.
  const uniquePhones = Array.from(
    new Set(
      inputs
        .map((i) => i.phone10)
        .filter((p) => p.length === 10 && !isExcludedFromReporting(p)),
    ),
  );
  const phoneDataMap = new Map<
    string,
    { candidates: ApptCandidate[]; alreadyActivated: boolean }
  >();
  for (let i = 0; i < uniquePhones.length; i += LOOKUP_CONCURRENCY) {
    const chunk = uniquePhones.slice(i, i + LOOKUP_CONCURRENCY);
    const results = await Promise.all(chunk.map((p) => loadOne(p)));
    chunk.forEach((p, idx) => phoneDataMap.set(p, results[idx]));
  }
  console.log(
    `[sale-match] pre-fetched ${phoneDataMap.size} unique phones (${
      Math.ceil(uniquePhones.length / LOOKUP_CONCURRENCY)
    } batches of ${LOOKUP_CONCURRENCY})`,
  );

  // Collect all writes here and commit as one batch at the end. With report
  // 678 we can have hundreds of matches × 2 writes each — sequential
  // client.set() calls easily blew past Deno Deploy's 60s request limit.
  // One Firestore batch.commit() is essentially a single round trip.
  const writes: BatchOp[] = [];

  // Track which phones go from not-activated → activated this run so we
  // can increment the daily/lifetime activations counters only for NEW
  // activations (re-runs of the same QB report shouldn't double-count).
  const newlyActivatedPhones: string[] = [];

  for (const { phone10, saleAt, activator, office } of inputs) {
    if (phone10.length !== 10) {
      summary.skippedNoInjection++;
      summary.skippedNoInjectionList?.push({
        phone10,
        activatedAt: saleAt ?? "",
      });
      continue;
    }
    // Excluded test phones (Adam's, Edwin's, etc.) must never get sale-match
    // docs written — they'd pollute the dashboard counts and could fire the
    // dialer at the operator. Treat as silently skipped.
    if (isExcludedFromReporting(phone10)) {
      summary.skippedNoInjection++;
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

    // Pulled from the pre-fetched parallel map above. Missing entries
    // (shouldn't happen — we built the map from the same input set) get
    // the empty-candidate fallback so the decision tree still runs.
    const lookup = phoneDataMap.get(phone10) ??
      { candidates: [] as ApptCandidate[], alreadyActivated: false };
    const candidates = lookup.candidates;
    const phoneAlreadyActivated = lookup.alreadyActivated;
    const odrKind = odrReason(activator, office);

    // Pick the closest in-window candidate (if any). Day-level diff in ET so
    // a same-day activation doesn't false-reject.
    let best: ApptCandidate | null = null;
    let bestWithinDays = Infinity;
    for (const c of candidates) {
      if (!isWithinDayWindow(c.eventTimeMs, saleMs, windowDaysConfigured)) {
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
        `${easternDateString(new Date(c.eventTimeMs))}(d=${
          dayDiff(c.eventTimeMs, saleMs)
        })`
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
    let eventTimePlaceholder = false;

    if (best) {
      appointmentAt = best.eventTime;
      withinDays = bestWithinDays;
      matchReason = "within_window";
      eventTimePlaceholder = best.placeholderTime;
      console.log(
        `[sale-match] ✅ ${phone10} sale=${saleDay} appts=[${apptSummary}] → matched ${
          easternDateString(new Date(best.eventTimeMs))
        } (${bestWithinDays}d)`,
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
      eventTimePlaceholder = ref.placeholderTime;
      console.log(
        `[sale-match] ✅ ${phone10} sale=${saleDay} appts=[${apptSummary}] activator="${
          activator ?? ""
        }" office="${office ?? ""}" → matched (${odrKind}, ${withinDays}d)`,
      );
    } else {
      // Already credited as a sale (manual claim, prior cron match, etc.) —
      // do NOT re-park them in the outside-window drill. Also clean up any
      // pre-existing salesoutsidewindow doc so the drill stops showing them.
      if (phoneAlreadyActivated) {
        console.log(
          `[sale-match] ⏭ ${phone10} sale=${saleDay} → already activated; skipping outside-window write`,
        );
        writes.push({
          type: "delete",
          path: salesOutsideWindowDocPath(phone10),
        });
        continue;
      }
      console.log(
        `[sale-match] ⏭ ${phone10} sale=${saleDay} appts=[${apptSummary}] activator="${
          activator ?? ""
        }" office="${office ?? ""}" → outside ${windowDaysConfigured}d window`,
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
          windowDays: windowDaysConfigured,
          updatedAt: new Date().toISOString(),
        },
      });
      continue;
    }

    const updatedAt = new Date().toISOString();
    const saleAtIso = new Date(saleMs).toISOString();
    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt,
      saleAt: saleAtIso,
      windowDays: windowDaysConfigured,
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
        // activatedAt = the actual sale date from QB, NOT the cron-run time.
        // Otherwise the drill shows every row with the same "today" timestamp.
        activatedAt: saleAtIso,
        eventTime: appointmentAt,
        // True when appointmentAt is the bot-message timestamp from a
        // booking-scan recovery (we couldn't parse the real appt time).
        // Dashboard renders "(no time recorded)" instead of showing this
        // misleading near-activation timestamp as if it were the appt.
        eventTimePlaceholder,
        // Persist the computed window-days on the activated doc so the
        // dashboard's qualifying filter (server stats + client modal) can
        // short-circuit on it. Otherwise both sides re-parse `eventTime`
        // strings and disagree on naive-ISO records (no TZ offset = parsed
        // in server-local vs browser-local time).
        withinDays,
        matchReason,
        recordedAt: updatedAt,
        ...(activator ? { activator } : {}),
        ...(office ? { office } : {}),
      },
    });
    // Auto-write guestanswered too — a closed sale implies the dialer
    // spoke with the customer. Without this, dashboard would show
    // activated > answered (impossible relationship).
    writes.push({
      type: "set",
      path: guestAnsweredDocPath(phone10),
      data: { phone10, answered: true, answeredAt: saleAtIso },
    });
    // If this phone was previously parked in salesoutsidewindow (e.g. earlier
    // run before we knew about the office field), clean that up so the drill-in
    // doesn't keep showing it as a near-miss after we've now counted it.
    writes.push({
      type: "delete",
      path: salesOutsideWindowDocPath(phone10),
    });

    summary.matched++;
    if (
      matchReason === "odr_activator" ||
      matchReason === "odr_office" ||
      matchReason === "second_chance_activator"
    ) {
      summary.matchedByOdr++;
    }
    // Only count this phone toward the activations counter if we're
    // actually flipping them from not-activated to activated. The
    // `phoneAlreadyActivated` flag was captured at the start of this
    // iteration before any writes.
    if (!phoneAlreadyActivated) {
      newlyActivatedPhones.push(phone10);
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

  // Activations counter increments (daily + lifetime). Fire-and-forget;
  // these power the nightly report and a failure here must not block
  // the rest of sale-match. Increments are atomic (FieldValue.increment)
  // and grouped per ET day, so a single cron run typically touches one
  // daily doc + the lifetime doc.
  if (newlyActivatedPhones.length > 0) {
    const byDay = new Map<string, number>();
    for (const phone10 of newlyActivatedPhones) {
      // saleAt is what we used for activatedAt above; bucket activations
      // by the ET day of the sale, not the cron-run day.
      const match = summary.matches.find((m) => m.phone10 === phone10);
      const saleMs = match?.activatedAt
        ? new Date(match.activatedAt).getTime()
        : Date.now();
      const day = easternDateString(
        Number.isFinite(saleMs) ? new Date(saleMs) : new Date(),
      );
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
    const nowIso = new Date().toISOString();
    const total = newlyActivatedPhones.length;
    try {
      await Promise.all([
        ...Array.from(byDay.entries()).flatMap(([day, n]) => [
          client.incrementField(metricsDailyDocPath(day), { activations: n }),
          client.setMerge(metricsDailyDocPath(day), { updatedAt: nowIso }),
        ]),
        client.incrementField(metricsLifetimeDocPath(), { activations: total }),
        client.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIso }),
      ]);
      console.log(
        `[sale-match] activations counters: +${total} (lifetime), days=${
          Array.from(byDay.entries()).map(([d, n]) => `${d}:+${n}`).join(",")
        }`,
      );
    } catch (e) {
      console.warn(
        `[sale-match] activations counter writes failed (non-fatal): ${
          (e as Error).message
        }`,
      );
    }
  }

  // Auto-pull conversations for any sale where withinDays < 0 (sale recorded
  // BEFORE the appointment). The originating Bland conversation is older
  // than yesterday's reseed window, so the dashboard's phone-link search
  // would otherwise return nothing. Awaited so cron logs reflect what we
  // actually pulled. Failures are logged, never thrown — partial recovery
  // beats no recovery.
  const negatives = summary.matches.filter((m) =>
    typeof m.withinDays === "number" && m.withinDays < 0
  );
  if (negatives.length > 0) {
    const { reseedConversationsForPhone } = await import(
      "@shared/services/conversations/reseed.ts"
    );
    console.log(
      `[sale-match] 🩹 ${negatives.length} sale(s) recorded before appt — auto-pulling Bland conversations: ${
        negatives.map((n) => n.phone10).join(", ")
      }`,
    );
    for (const n of negatives) {
      try {
        const r = await reseedConversationsForPhone(n.phone10);
        console.log(
          `[sale-match]   ↳ ${n.phone10}: bland=${r.blandConversations} reseeded=${r.reseeded} delta=+${r.netMessagesAdded}`,
        );
      } catch (e) {
        console.error(
          `[sale-match]   ↳ ${n.phone10}: pull failed — ${
            (e as Error).message
          }`,
        );
      }
    }
  }

  return summary;
}
