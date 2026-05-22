// Audit every pending scheduledinjection and classify it so we can
// decide what to do with the backlog that piled up while the sweep
// cron was silently broken. Read-only — prints a table, no writes.
//
// For each pending doc, we cross-check:
//   - injectionhistory entries for the same phone (was the customer
//     already dialed by talk-now / a previous sweep / booking-scan?)
//   - guestactivated (did the customer become a sale anyway?)
//   - eventTime vs now (overdue? by how long? in the future?)
//   - eventTime TZ format (the "no Z, no offset" bug we saw on
//     7164674843 means the sweep would dial 4h early in ET)
//
// Output:
//   - Markdown table with one row per pending phone, sorted by
//     daysOverdue desc (oldest first)
//   - A summary line counting each classification
//   - A "RECOMMENDED ACTION" column with one of:
//     * delete-already-dialed   - has injectionhistory entry; just stale
//     * delete-already-activated- has guestactivated; sale credited
//     * fire-or-delete-overdue  - never dialed, eventTime long past;
//                                 dialing now is awkward, but the
//                                 customer waited so either close the
//                                 loop or quietly delete
//     * leave-future            - eventTime in future, let the sweep
//                                 fire it (once the sweep works)
//
// Usage:
//   deno run -A --env-file=env/local scripts/inspect-pending-injections.ts

import {
  guestActivatedDocPath,
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const db = getFirestoreClient();
const nowMs = Date.now();

console.log(
  "🔍 inspect-pending-injections: enumerating all pending scheduledinjections",
);

const pending = await db.list(scheduledInjectionsCollection, { limit: 1_000 });
console.log(`📊 found ${pending.length} pending doc(s)`);
console.log("");

interface Row {
  phone10: string;
  eventTime: string;
  eventTimeIso: string;
  eventTimeMs: number | null;
  daysOverdue: number | null;
  hasTzMarker: boolean;
  historyEntries: Array<{ docId: string; firedBy: string; firedAt: string }>;
  activated: boolean;
  recommendation: string;
}

const rows: Row[] = [];

for (const e of pending) {
  const data = e.data as Record<string, unknown>;
  const phone10 = String(data.phone ?? e.id);
  const eventTime = typeof data.eventTime === "string" ? data.eventTime : "";
  // The TZ-naive bug: "2026-05-19T12:00:00" with no Z and no ±HH:MM
  // gets interpreted as UTC by JavaScript, which is 4h off from ET.
  const hasTzMarker = /Z$/.test(eventTime) ||
    /[+-]\d{2}:?\d{2}$/.test(eventTime);
  const eventMs = new Date(eventTime).getTime();
  const daysOverdue = Number.isFinite(eventMs)
    ? Math.round((nowMs - eventMs) / 86_400_000 * 10) / 10
    : null;

  // Per-phone history + activated lookups in parallel.
  const [historyDocs, activatedDoc] = await Promise.all([
    db.list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone10 },
      limit: 50,
    }),
    db.get(guestActivatedDocPath(phone10)),
  ]);

  const historyEntries = historyDocs.map((h) => {
    const d = h.data as Record<string, unknown>;
    return {
      docId: h.id,
      firedBy: String(d.firedBy ?? "?"),
      firedAt: String(d.firedAt ?? ""),
    };
  });

  let recommendation = "?";
  if (activatedDoc) {
    recommendation = "delete-already-activated";
  } else if (historyEntries.length > 0) {
    recommendation = "delete-already-dialed";
  } else if (daysOverdue !== null && daysOverdue < 0) {
    recommendation = "leave-future";
  } else if (daysOverdue !== null && daysOverdue >= 0) {
    recommendation = "fire-or-delete-overdue";
  }

  rows.push({
    phone10,
    eventTime,
    eventTimeIso: Number.isFinite(eventMs)
      ? new Date(eventMs).toISOString()
      : "(unparseable)",
    eventTimeMs: Number.isFinite(eventMs) ? eventMs : null,
    daysOverdue,
    hasTzMarker,
    historyEntries,
    activated: activatedDoc !== null,
    recommendation,
  });
}

// Sort by daysOverdue desc (most overdue first); future ones at the end.
rows.sort((a, b) => {
  const aD = a.daysOverdue ?? -Infinity;
  const bD = b.daysOverdue ?? -Infinity;
  return bD - aD;
});

// Markdown table.
console.log(
  "| phone10    | eventTime stored          | daysOverdue | tz? | history (firedBy)          | activated | recommendation             |",
);
console.log(
  "|------------|---------------------------|-------------|-----|----------------------------|-----------|----------------------------|",
);
for (const r of rows) {
  const evt = r.eventTime.padEnd(25).slice(0, 25);
  const days = r.daysOverdue === null
    ? "?".padStart(11)
    : (r.daysOverdue > 0
      ? `+${r.daysOverdue.toFixed(1)}d`
      : `${r.daysOverdue.toFixed(1)}d`).padStart(11);
  const tz = r.hasTzMarker ? "✓ " : "❌";
  const histSummary = r.historyEntries.length === 0
    ? "(none)"
    : r.historyEntries
      .map((h) => `${h.firedBy}@${h.firedAt.slice(0, 10)}`)
      .join(", ");
  const act = r.activated ? "✓ YES" : "—";
  console.log(
    `| ${r.phone10} | ${evt} | ${days} | ${tz}  | ${
      histSummary.padEnd(26).slice(0, 26)
    } | ${act.padEnd(9)} | ${r.recommendation.padEnd(26)} |`,
  );
}

// Summary by recommendation.
console.log("");
const counts: Record<string, number> = {};
for (const r of rows) {
  counts[r.recommendation] = (counts[r.recommendation] ?? 0) + 1;
}
console.log("Summary by recommendation:");
for (const [rec, n] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${rec.padEnd(28)} ${n}`);
}

// TZ-naive count — these are at risk of dialing 4h early in ET when the
// sweep does fire.
const tzNaiveCount = rows.filter((r) => !r.hasTzMarker).length;
console.log("");
if (tzNaiveCount > 0) {
  console.log(
    `⚠️  ${tzNaiveCount} pending doc(s) have a TZ-naive eventTime (no Z, no ±HH:MM).`,
  );
  console.log(
    `    These would be interpreted as UTC by the sweep — likely 4h off from ET.`,
  );
  console.log(
    `    Worth fixing the eventTime format on these BEFORE letting the sweep fire.`,
  );
}

console.log("");
console.log("✅ done");
