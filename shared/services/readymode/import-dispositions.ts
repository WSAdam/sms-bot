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
  guestAnsweredDocPath,
} from "@shared/firestore/paths.ts";
import {
  type BatchOp,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type { DialerCallRow } from "@shared/services/readymode/portal-client.ts";

// Disposition strings that mean "the call did not connect with a human".
// Mirrors the rule used by scripts/import-call-dispositions.ts.
const NON_ANSWERED = new Set<string>(["No Answer", "TEST"]);

export interface ImportDispositionsSummary {
  rowsFetched: number;
  dispositionsWritten: number;
  answeredUpserted: number;
  answeredAlreadyEarlier: number;
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

    // Always write the disposition record.
    ops.push({
      type: "set",
      path: callDispositionDocPath(r.phone10, r.callLogId),
      data: {
        phone10: r.phone10,
        callLogId: r.callLogId,
        callTime: r.callTime,
        agentName: r.agentName,
        disposition: r.disposition,
        callType: r.callType,
        domain: r.domain,
        recId: r.recId,
        recordedAt: new Date().toISOString(),
      },
    });
    summary.dispositionsWritten++;

    // Track earliest answered call per phone for the upsert.
    if (!NON_ANSWERED.has(r.disposition)) {
      const cur = earliestAnsweredInBatch.get(r.phone10);
      if (!cur || r.callTime < cur) {
        earliestAnsweredInBatch.set(r.phone10, r.callTime);
      }
    }
  }

  // Read existing guestanswered docs in parallel; only write when our
  // batch's earliest is EARLIER than what's stored. Preserves the
  // "first time we ever spoke with them" semantics.
  const phones = Array.from(earliestAnsweredInBatch.keys());
  const existing = await Promise.all(
    phones.map((p) => db.get(guestAnsweredDocPath(p))),
  );
  for (let i = 0; i < phones.length; i++) {
    const phone10 = phones[i];
    const newAt = earliestAnsweredInBatch.get(phone10)!;
    const cur = existing[i];
    const curAt = typeof cur?.answeredAt === "string"
      ? cur.answeredAt
      : null;
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
    `[rm-import] done: rows=${summary.rowsFetched} excluded=${summary.excludedSkipped} dispositions=${summary.dispositionsWritten} answered=${summary.answeredUpserted} (already-earlier=${summary.answeredAlreadyEarlier})`,
  );
  return summary;
}
