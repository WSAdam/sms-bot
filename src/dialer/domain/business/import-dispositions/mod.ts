// Persists scraped ReadyMode call dispositions to Firestore + upserts
// guestanswered for any answered call (per the isAnsweredCall gate below).
// Subsumes the recurring case of scripts/import-call-dispositions.ts (which
// stays for one-off CSV imports).
//
// Idempotent: each call is keyed by RM's `callLogId` (server-side primary
// key). A re-run over the same date range never double-writes.

import {
  ANSWERED_MIN_SECONDS,
  isExcludedFromReporting,
  NO_ANSWER_ANSWERED_MIN_SECONDS,
} from "@shared/config/constants.ts";
import {
  callDispositionDocPath,
  guestActivatedCollection,
  guestAnsweredDocPath,
  injectionHistoryCollection,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { type BatchOp, getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type { DialerCallRow } from "@dialer/domain/data/portal-client/mod.ts";
import { easternDateString } from "@shared/util/time.ts";

// "Did this call connect with a human?" — the single source of truth for the
// answered gate, shared by the live import AND the campaign backfill so the two
// can't drift (see scripts/backfill-answered-by-campaign.ts).
//
// A scraped call counts as answered when EITHER:
//   • a non-No-Answer disposition AND >= ANSWERED_MIN_SECONDS (60s) of talk, OR
//   • a "No Answer" disposition that nonetheless ran >= NO_ANSWER_ANSWERED_MIN_SECONDS
//     (180s) — a No-Answer that long is almost always a mis-disposition (the
//     agent had a real conversation and fat-fingered the outcome), so we count
//     the CONNECT here. The agent's original disposition string is left
//     untouched in calldispositions; only the answered flag flips.
//
// The No-Answer substring match catches the literal "No Answer" plus
// team-prefixed variants RM uses ("ODR No Answer", "2ND No Answer", etc). TEST
// rows are administrative and never count.
export function isAnsweredCall(
  disposition: string,
  durationSecs: number,
): boolean {
  const norm = disposition.toLowerCase().trim();
  if (norm === "test") return false;
  if (norm.includes("no answer")) {
    return durationSecs >= NO_ANSWER_ANSWERED_MIN_SECONDS;
  }
  return durationSecs >= ANSWERED_MIN_SECONDS;
}

// RM serves disposition strings with HTML entities baked in (e.g. transfer
// rows render as " &rArr; Andrew Torsiello" → "⇒ Andrew Torsiello").
// Decode the small set we've actually seen so they store cleanly.
function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&rArr;/g, "⇒")
    .replace(/&rarr;/g, "→")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .trim();
}

export interface ImportDispositionsSummary {
  rowsFetched: number;
  dispositionsWritten: number;
  answeredUpserted: number;
  answeredAlreadyEarlier: number;
  answeredOutOfSystemSkipped: number;
  excludedSkipped: number;
  byDomain: Record<string, number>;
}

export async function importDailyDispositions(
  rows: DialerCallRow[],
  opts: { requireInFunnel?: boolean } = {},
): Promise<ImportDispositionsSummary> {
  // When the scrape is restricted to our leads' campaign (Appointments), every
  // answered call is one of ours, so the injectionhistory funnel gate is both
  // unnecessary and HARMFUL — it undercounts leads loaded into ODR directly
  // (the bug behind the historically low "answered" count). Default true keeps
  // the safe behavior for all-campaigns imports (which still need the gate).
  const requireInFunnel = opts.requireInFunnel ?? true;
  const summary: ImportDispositionsSummary = {
    rowsFetched: rows.length,
    dispositionsWritten: 0,
    answeredUpserted: 0,
    answeredAlreadyEarlier: 0,
    answeredOutOfSystemSkipped: 0,
    excludedSkipped: 0,
    byDomain: {},
  };

  // Dedupe by callLogId — server primary key. Should already be unique
  // per page but a re-run across days could overlap.
  const seen = new Set<string>();
  const unique: DialerCallRow[] = [];
  for (const r of rows) {
    if (seen.has(r.callLogId)) continue;
    seen.add(r.callLogId);
    unique.push(r);
  }

  const db = getFirestoreClient();
  const ops: BatchOp[] = [];

  // Earliest answered timestamp per phone in this batch (for the
  // guestanswered upsert). We compare to existing storage in a second pass.
  const earliestAnsweredInBatch = new Map<string, string>();

  for (const r of unique) {
    if (isExcludedFromReporting(r.phone10)) {
      summary.excludedSkipped++;
      continue;
    }
    summary.byDomain[r.domain] = (summary.byDomain[r.domain] ?? 0) + 1;

    const disposition = decodeHtmlEntities(r.disposition);

    // Always write the disposition record.
    ops.push({
      type: "set",
      path: callDispositionDocPath(r.phone10, r.callLogId),
      data: {
        phone10: r.phone10,
        callLogId: r.callLogId,
        callTime: r.callTime,
        agentName: r.agentName,
        disposition,
        callType: r.callType,
        durationSecs: r.durationSecs,
        domain: r.domain,
        recId: r.recId,
        recordedAt: new Date().toISOString(),
      },
    });
    summary.dispositionsWritten++;

    // Track earliest answered call per phone for the upsert. The gate
    // (isAnsweredCall) folds in both the duration floor and the No-Answer
    // override — short blips never count, and a "No Answer" only counts when it
    // ran long enough to be a mis-disposition. See isAnsweredCall above.
    if (isAnsweredCall(disposition, r.durationSecs)) {
      const cur = earliestAnsweredInBatch.get(r.phone10);
      if (!cur || r.callTime < cur) {
        earliestAnsweredInBatch.set(r.phone10, r.callTime);
      }
    }
  }

  // Build the "phone is in our funnel" gate from the same canonical sources
  // the dashboard's "Appointments Booked" count uses: scheduledinjections
  // (booked, awaiting injection), injectionhistory (already injected), and
  // guestactivated (a sale we've credited — covers historical bookings that
  // pre-date the injection-records era). RM's portal returns dispositions
  // for every dial it placed, including for phones we never put into the
  // dialer (other teams' campaigns, manual dials). Marking those "answered"
  // flooded the funnel — answered must stay ⊆ phones we ourselves booked /
  // injected, otherwise the invariant answered ⊆ booked breaks.
  // Skipped when requireInFunnel=false (campaign-restricted scrape already
  // guarantees every row is one of our leads).
  const inFunnel = requireInFunnel
    ? await loadInFunnelPhones(db)
    : new Set<string>();

  // Read existing guestanswered docs in parallel for the in-funnel subset.
  const phones = Array.from(earliestAnsweredInBatch.keys());
  const existing = await Promise.all(
    phones.map((p) => db.get(guestAnsweredDocPath(p))),
  );
  // `answered` daily-counter deltas, bucketed by the ET day of the answered
  // call. firstEver feeds the lifetime counter; the per-day map handles the
  // re-import case where a phone's earliest answer moves to an earlier day.
  const answeredDayDelta = new Map<string, number>();
  let answeredFirstEver = 0;
  for (let i = 0; i < phones.length; i++) {
    const phone10 = phones[i];
    if (requireInFunnel && !inFunnel.has(phone10)) {
      summary.answeredOutOfSystemSkipped++;
      continue;
    }
    const newAt = earliestAnsweredInBatch.get(phone10)!;
    const cur = existing[i];
    const curAt = typeof cur?.answeredAt === "string" ? cur.answeredAt : null;
    if (curAt && curAt <= newAt) {
      summary.answeredAlreadyEarlier++;
      continue;
    }
    // Counter bookkeeping (we only reach here on a first-ever answer or an
    // earlier-than-stored answer — the `curAt <= newAt` short-circuit above
    // already returned). First-ever = +1 on its day + lifetime. Moved-earlier
    // across ET days = +1 new day, −1 old day, no lifetime change.
    const newDay = easternDateString(new Date(newAt));
    if (!curAt) {
      answeredFirstEver++;
      answeredDayDelta.set(newDay, (answeredDayDelta.get(newDay) ?? 0) + 1);
    } else {
      const oldDay = easternDateString(new Date(curAt));
      if (oldDay !== newDay) {
        answeredDayDelta.set(newDay, (answeredDayDelta.get(newDay) ?? 0) + 1);
        answeredDayDelta.set(oldDay, (answeredDayDelta.get(oldDay) ?? 0) - 1);
      }
    }
    // Find the disposition that corresponds to the earliest answered call
    // in this batch (for the lastDisposition snapshot).
    const dispoForLog = unique.find((r) =>
      r.phone10 === phone10 && r.callTime === newAt
    )?.disposition ?? "(unknown)";
    ops.push({
      type: "set",
      path: guestAnsweredDocPath(phone10),
      data: {
        phone10,
        answered: true,
        answeredAt: newAt,
        source: "readymode-call-log",
        lastDisposition: dispoForLog,
      },
    });
    summary.answeredUpserted++;
  }

  if (ops.length > 0) {
    console.log(
      `[rm-import] committing ${ops.length} writes (${summary.dispositionsWritten} dispositions, ${summary.answeredUpserted} answered upserts)`,
    );
    await db.batch(ops);
  }

  // `answered` daily + lifetime counters (powers the nightly report's "calls
  // answered" stat). Fire-and-forget AFTER the batch commit — a counter
  // failure must never block the disposition/answered writes. Same fail-safe
  // posture as the sale-match activations counter.
  const answeredDayEntries = Array.from(answeredDayDelta.entries()).filter(
    ([, n]) => n !== 0,
  );
  if (answeredDayEntries.length > 0 || answeredFirstEver > 0) {
    const nowIso = new Date().toISOString();
    // Apply one day's delta. Positive = a plain atomic increment + stamp.
    // Negative (a re-import moved an answer off this day) clamps at 0 via a
    // transactional read+write — a day whose original answer predates this
    // counter was never incremented, so a blind −1 would drive it negative
    // until the backfill seeds it.
    const applyAnsweredDelta = (day: string, n: number) =>
      n > 0
        ? Promise.all([
          db.incrementField(metricsDailyDocPath(day), { answered: n }),
          db.setMerge(metricsDailyDocPath(day), { updatedAt: nowIso }),
        ])
        : db.transactionalUpdate(metricsDailyDocPath(day), (cur) => {
          const prevRaw = cur?.answered;
          const prev = typeof prevRaw === "number" && Number.isFinite(prevRaw)
            ? prevRaw
            : 0;
          return {
            ...(cur ?? {}),
            answered: Math.max(0, prev + n),
            updatedAt: nowIso,
          };
        });
    try {
      await Promise.all([
        ...answeredDayEntries.map(([day, n]) => applyAnsweredDelta(day, n)),
        ...(answeredFirstEver > 0
          ? [
            db.incrementField(metricsLifetimeDocPath(), {
              answered: answeredFirstEver,
            }),
            db.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIso }),
          ]
          : []),
      ]);
      console.log(
        `[rm-import] answered counters: +${answeredFirstEver} (lifetime), days=${
          answeredDayEntries.map(([d, n]) => `${d}:${n >= 0 ? "+" : ""}${n}`)
            .join(",") || "(none)"
        }`,
      );
    } catch (e) {
      console.warn(
        `[rm-import] answered counter writes failed (non-fatal): ${
          (e as Error).message
        }`,
      );
    }
  }

  console.log(
    `[rm-import] done: rows=${summary.rowsFetched} excluded=${summary.excludedSkipped} dispositions=${summary.dispositionsWritten} answered=${summary.answeredUpserted} (already-earlier=${summary.answeredAlreadyEarlier}, out-of-system=${summary.answeredOutOfSystemSkipped})`,
  );
  return summary;
}

// Phones with any record in scheduledinjections (id == phone), injectionhistory
// (id starts with "{phone}__"), or guestactivated (id == phone). Mirrors the
// universe the dashboard's "Booked" stat counts, so answered⊆booked holds.
async function loadInFunnelPhones(
  db: ReturnType<typeof getFirestoreClient>,
): Promise<Set<string>> {
  const [pending, history, activated] = await Promise.all([
    db.list(scheduledInjectionsCollection),
    db.list(injectionHistoryCollection),
    db.list(guestActivatedCollection),
  ]);
  const set = new Set<string>();
  for (const r of pending) set.add(r.id);
  for (const r of history) {
    const sep = r.id.indexOf("__");
    set.add(sep > 0 ? r.id.slice(0, sep) : r.id);
  }
  for (const r of activated) set.add(r.id);
  return set;
}
