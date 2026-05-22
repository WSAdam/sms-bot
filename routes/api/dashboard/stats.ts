// Aggregated dashboard stats. Pre-refactor this scanned 10 collections
// at limit:50_000 each (~50k reads, 9.4s wall time per page load — see
// firestore-safety.md). Now reads from the write-side aggregator docs
// (`metrics/lifetime/totals`, `metrics/daily/{date}`, the
// `metrics/kvBreakdown/totals` counter doc) plus a handful of small
// targeted lists. Target: <1 second wall time.
//
// Response shape is unchanged — the dashboard JS in shared/ui/pages.ts
// reads the same field names as before. Lifetime numbers come from
// `metrics/lifetime/totals`; date-filtered numbers sum the daily docs.

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  guestActivatedCollection,
  guestAnsweredCollection,
  metricsDailyDocPath,
  metricsKvBreakdownDocPath,
  metricsLifetimeDocPath,
  salesWithin7dCollection,
  uniqueGuestsByPhoneCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import type { ConversationMessage } from "@shared/types/conversation.ts";
import { easternDateString } from "@shared/util/time.ts";

// Bounded reads for surfaces we don't yet have a counter for. Each of
// these collections is small (<10k docs in the foreseeable future) and
// the read happens once per dashboard load. If any grows past ~30k,
// add a write-side counter (same shape as `metrics/lifetime/totals`).
const SMALL_LIST_LIMIT = 10_000;

interface BreakdownEntry {
  count: number;
}

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

// Walk the date range one ET day at a time, return YYYY-MM-DD list.
// Inclusive of both ends. Used to fan out parallel daily metric reads.
function etDaysInRange(startDate: string, endDate: string): string[] {
  const [sy, sm, sd] = startDate.split("-").map((n) => Number(n));
  const [ey, em, ed] = endDate.split("-").map((n) => Number(n));
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const days: string[] = [];
  for (let t = startMs; t <= endMs; t += 86_400_000) {
    const dt = new Date(t);
    days.push(
      `${dt.getUTCFullYear()}-${
        String(dt.getUTCMonth() + 1).padStart(2, "0")
      }-${String(dt.getUTCDate()).padStart(2, "0")}`,
    );
    if (days.length > 366) break; // safety cap
  }
  return days;
}

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const startDate = url.searchParams.get("startDate");
    const endDate = url.searchParams.get("endDate");
    const haveDateFilter = !!(startDate || endDate);

    const db = getFirestoreClient();
    const gates = await getGatesConfig();
    const { saleMatchWindowDays, costPerText, earningsPerSale } = gates;

    // Parallel reads: 1 lifetime doc + 1 kvBreakdown doc + 4 small
    // collection lists + 1 recent-activity orderBy/limit + (optional)
    // date-bucketed daily docs + (optional) date-filtered conversation
    // slice. No full-collection scans.
    const dateDays = startDate && endDate
      ? etDaysInRange(startDate, endDate)
      : startDate
      ? etDaysInRange(startDate, easternDateString())
      : null;

    const [
      lifetimeDoc,
      kvBreakdownDoc,
      activatedList,
      answeredList,
      saleswithin7dList,
      uniqueGuestsList,
      recentMessages,
      dailyDocs,
    ] = await Promise.all([
      db.get(metricsLifetimeDocPath()),
      db.get(metricsKvBreakdownDocPath()),
      db.list(guestActivatedCollection, { limit: SMALL_LIST_LIMIT }),
      db.list(guestAnsweredCollection, { limit: SMALL_LIST_LIMIT }),
      db.list(salesWithin7dCollection, { limit: SMALL_LIST_LIMIT }),
      db.list(uniqueGuestsByPhoneCollection, { limit: 100_000 }),
      db.list(conversationsCollection, {
        orderBy: { field: "timestamp", dir: "desc" },
        limit: 50,
      }),
      dateDays
        ? Promise.all(dateDays.map((d) => db.get(metricsDailyDocPath(d))))
        : Promise.resolve([] as Array<Record<string, unknown> | null>),
    ]);

    // ------------------------------------------------------------------
    // Lifetime numbers — all from the write-side counter doc.
    // ------------------------------------------------------------------
    const lifetimeOutboundTexts = num(lifetimeDoc?.textsSent);
    const lifetimeAppointmentsBooked = num(lifetimeDoc?.apptsBooked);
    const lifetimeActivatedFromCounter = num(lifetimeDoc?.activations);

    // Filter excluded test phones from the small lists. None of these
    // are large enough for the cost to matter.
    const activatedFiltered = activatedList.filter((e) =>
      !isExcludedFromReporting(docIdToPhone10(e.id))
    );
    const answeredFiltered = answeredList.filter((e) =>
      !isExcludedFromReporting(docIdToPhone10(e.id))
    );
    const saleswithin7dFiltered = saleswithin7dList.filter((e) =>
      !isExcludedFromReporting(docIdToPhone10(e.id))
    );
    const uniqueGuestsFiltered = uniqueGuestsList.filter((e) =>
      !isExcludedFromReporting(docIdToPhone10(e.id))
    );

    const activatedLifetimeCount = activatedFiltered.length;
    const answeredCount = answeredFiltered.length;
    const lifetimeSalesMatched = saleswithin7dFiltered.length;
    const lifetimeUniqueGuests = uniqueGuestsFiltered.length;

    // "Activated qualifying within window" — filter the small
    // guestactivated list by withinDays (or compute from event/activated
    // times for legacy docs that pre-date the field).
    const activatedQualifyingCount = activatedFiltered.filter((e) => {
      const data = e.data as Record<string, unknown>;
      const wd = data.withinDays;
      if (typeof wd === "number") return Math.abs(wd) <= saleMatchWindowDays;
      // Legacy doc — derive from |activatedAt - eventTime|.
      const activatedAt = typeof data.activatedAt === "string"
        ? data.activatedAt
        : null;
      const eventTime = typeof data.eventTime === "string"
        ? data.eventTime
        : null;
      if (!activatedAt || !eventTime) return false;
      const aMs = new Date(activatedAt).getTime();
      const eMs = new Date(eventTime).getTime();
      if (!Number.isFinite(aMs) || !Number.isFinite(eMs)) return false;
      return Math.abs(aMs - eMs) / 86_400_000 <= saleMatchWindowDays;
    }).length;

    // People-replied lifetime — count docs with hasReplied=true.
    const peopleRepliedLifetime = uniqueGuestsFiltered.filter((e) =>
      (e.data as Record<string, unknown>).hasReplied === true
    ).length;

    // ------------------------------------------------------------------
    // Date-filtered numbers — sum the per-day metric docs.
    // ------------------------------------------------------------------
    let dateTextsSent = lifetimeOutboundTexts;
    let dateAppointmentsSet = lifetimeAppointmentsBooked;
    let dateActivations = lifetimeActivatedFromCounter;
    if (haveDateFilter && dateDays) {
      dateTextsSent = 0;
      dateAppointmentsSet = 0;
      dateActivations = 0;
      for (const d of dailyDocs) {
        dateTextsSent += num((d as Record<string, unknown> | null)?.textsSent);
        dateAppointmentsSet += num(
          (d as Record<string, unknown> | null)?.apptsBooked,
        );
        dateActivations += num(
          (d as Record<string, unknown> | null)?.activations,
        );
      }
    }

    // ------------------------------------------------------------------
    // Recent activity feed — 50 newest messages from the indexed sort.
    // Excluded phones filtered in-memory on the bounded result.
    // ------------------------------------------------------------------
    const recentEntries = recentMessages
      .filter((e) => {
        const msg = e.data as unknown as ConversationMessage;
        return !isExcludedFromReporting(msg.phoneNumber ?? "");
      })
      .map((e) => ({
        key: ["conversations", e.id],
        value: e.data,
      }));

    // ------------------------------------------------------------------
    // kvBreakdown — read straight from the counter doc. The doc has
    // one numeric field per container. We render it in the same shape
    // the old code emitted (per-container { count }) so the dashboard
    // JS doesn't need changes.
    // ------------------------------------------------------------------
    const kvBreakdown: Record<string, BreakdownEntry> = {};
    let totalKvEntries = 0;
    if (kvBreakdownDoc) {
      for (const [container, count] of Object.entries(kvBreakdownDoc)) {
        if (container === "updatedAt") {
          continue;
        }
        const c = num(count);
        kvBreakdown[container] = { count: c };
        totalKvEntries += c;
      }
    }

    // ------------------------------------------------------------------
    // Cost / profit derived from gatesConfig × lifetime counts.
    // ------------------------------------------------------------------
    const lifetimeCost = lifetimeOutboundTexts * costPerText;
    const lifetimeEarnings = activatedLifetimeCount * earningsPerSale;
    const lifetimeProfit = lifetimeEarnings - lifetimeCost;
    const penetrationPct = lifetimeUniqueGuests > 0
      ? (activatedLifetimeCount / lifetimeUniqueGuests) * 100
      : 0;

    return Response.json({
      stats: {
        // Date-filtered
        textsSent: dateTextsSent,
        uniquePhonesSent: dateTextsSent, // No per-day unique counter yet — use total
        initialTextsSent: dateTextsSent,
        peopleReplied: peopleRepliedLifetime,
        appointmentsSet: haveDateFilter
          ? dateAppointmentsSet
          : lifetimeAppointmentsBooked,
        // Lifetime
        totalKvEntries,
        activatedCount: activatedQualifyingCount,
        activatedLifetimeCount,
        saleMatchWindowDays,
        answeredCount,
        lifetimeAppointmentsBooked,
        lifetimeSalesMatched,
        lifetimeUniqueGuests,
        // Profitability
        lifetimeOutboundTexts,
        lifetimeCost,
        lifetimeEarnings,
        lifetimeProfit,
        penetrationPct,
        costPerText,
        earningsPerSale,
        // Debug: surface where each number came from so it's clear what
        // changed if a number looks off after the refactor.
        _source: {
          lifetimeFromCounter: lifetimeDoc !== null,
          dailyDocsRead: dailyDocs.length,
          kvBreakdownFromCounter: kvBreakdownDoc !== null,
        },
      },
      kvBreakdown,
      recentEntries,
    }, {
      headers: { "Cache-Control": "no-store" },
    });
  },
});

function docIdToPhone10(id: string): string {
  const idx = id.indexOf("__");
  return idx >= 0 ? id.slice(0, idx) : id;
}
