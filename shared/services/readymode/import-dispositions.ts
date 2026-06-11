// Persists scraped ReadyMode call dispositions to Firestore + upserts
// guestanswered for any non-No-Answer call. Subsumes the recurring case
// of scripts/import-call-dispositions.ts (which stays for one-off CSV
// imports).
//
// Idempotent: each call is keyed by RM's `callLogId` (server-side primary
// key). A re-run over the same date range never double-writes.

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  callDispositionDocPath,
  guestActivatedCollection,
  guestAnsweredDocPath,
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { type BatchOp, getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type { DialerCallRow } from "@shared/services/readymode/portal-client.ts";

// "Did this call connect with a human?" — substring match catches the
// literal "No Answer" plus team-prefixed variants RM uses ("ODR No Answer",
// "2ND No Answer", etc). TEST is administrative, not a real call.
function isNonAnswered(disposition: string): boolean {
  const norm = disposition.toLowerCase().trim();
  if (norm === "test") return true;
  if (norm.includes("no answer")) return true;
  return false;
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
): Promise<ImportDispositionsSummary> {
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
        domain: r.domain,
        recId: r.recId,
        recordedAt: new Date().toISOString(),
      },
    });
    summary.dispositionsWritten++;

    // Track earliest answered call per phone for the upsert.
    if (!isNonAnswered(disposition)) {
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
  const inFunnel = await loadInFunnelPhones(db);

  // Read existing guestanswered docs in parallel for the in-funnel subset.
  const phones = Array.from(earliestAnsweredInBatch.keys());
  const existing = await Promise.all(
    phones.map((p) => db.get(guestAnsweredDocPath(p))),
  );
  for (let i = 0; i < phones.length; i++) {
    const phone10 = phones[i];
    if (!inFunnel.has(phone10)) {
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
