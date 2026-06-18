// scripts/triage-readymode.ts
//
// Local triage for the daily report's "Yesterday" funnel — run it from your
// terminal instead of clicking through the Firebase console or the deployed
// admin UI. It reads the SAME Firestore docs the report reads (the cron-health
// markers + metrics/daily + metrics/lifetime), so you can tell whether a 0 in
// the email is a real measured zero or a failed-pull artifact (a missing
// `answered` field), and how many recent days are affected.
//
// With --pull it runs the live ReadyMode scrape for a date: this reveals the
// REAL per-domain error (the thing the cron used to bury in "see logs") and,
// on success, backfills calldispositions + guestanswered + the
// metrics/daily.answered counter the report reads. Idempotent over a range.
//
// RM enforces single-session-per-user: RM_USER must be logged OUT of the
// ReadyMode portal for --pull to succeed.
//
// Run:
//   deno run -A --env-file=env/local scripts/triage-readymode.ts
//   deno run -A --env-file=env/local scripts/triage-readymode.ts --pull --date=06/16/2026 --max-pages=1
//   deno run -A --env-file=env/local scripts/triage-readymode.ts --pull --date=06/16/2026
//   deno run -A --env-file=env/local scripts/triage-readymode.ts --pull --from=06/10/2026 --to=06/16/2026

import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import {
  metricsCronRunDocPath,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
} from "@shared/firestore/paths.ts";
import { scrapeReadymode } from "@shared/services/readymode/scrape-orchestrator.ts";

// ── arg parsing (--flag or --key=value) ────────────────────────────────
const flags = new Map<string, string>();
const bools = new Set<string>();
for (const a of Deno.args) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  if (v === undefined) bools.add(k);
  else flags.set(k, v);
}
const DO_PULL = bools.has("pull");

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}
function etToday(): string {
  return new Date().toLocaleDateString("en-CA", {
    timeZone: "America/New_York",
  });
}
function etDaysBack(n: number): string[] {
  const [y, m, d] = etToday().split("-").map(Number);
  const base = new Date(Date.UTC(y, m - 1, d));
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    const dt = new Date(base);
    dt.setUTCDate(base.getUTCDate() - i);
    out.push(dt.toISOString().slice(0, 10));
  }
  return out;
}

const db = getFirestoreClient();
console.log(
  `🔍 Report triage — project=${
    Deno.env.get("FIREBASE_PROJECT_ID")
  }  (ET today ${etToday()})\n`,
);

// ── read-only diagnosis (always runs) ──────────────────────────────────
const [pullMarker, saleMarker, lifetime] = await Promise.all([
  db.get(metricsCronRunDocPath("readymode-daily-pull")),
  db.get(metricsCronRunDocPath("daily-qb-sale-match")),
  db.get(metricsLifetimeDocPath()),
]);

console.log("⏰ Cron health (the two pulls that feed the Yesterday funnel):");
console.log(
  `  readymode-daily-pull → ${JSON.stringify(pullMarker ?? "(missing)")}`,
);
console.log(
  `  daily-qb-sale-match  → ${JSON.stringify(saleMarker ?? "(missing)")}`,
);
console.log(
  `\n∑ metrics/lifetime/totals → ${JSON.stringify(lifetime ?? "(missing)")}\n`,
);

const scanDays = flags.has("days") ? Math.max(1, Number(flags.get("days"))) : 8;
const days = etDaysBack(scanDays);
const dailyDocs = await Promise.all(
  days.map((d) => db.get(metricsDailyDocPath(d))),
);
console.log(
  `📅 metrics/daily (last ${scanDays} ET days) — ⚠ marks a day whose \`answered\` field is MISSING\n` +
    "   (a missing field = the report shows 0, but it's 'not collected', not a real zero):",
);
for (let i = 0; i < days.length; i++) {
  const doc = (dailyDocs[i] ?? {}) as Record<string, unknown>;
  const hasAnswered = "answered" in doc;
  const hasActs = "activations" in doc;
  const flag = hasAnswered ? "   " : " ⚠ ";
  console.log(
    `${flag}${days[i]}  texts=${num(doc.textsSent)}  appts=${
      num(doc.apptsBooked)
    }  answered=${hasAnswered ? num(doc.answered) : "(none)"}  activations=${
      hasActs ? num(doc.activations) : "(none)"
    }  updatedAt=${doc.updatedAt ?? "-"}`,
  );
}
console.log("");

// ── optional live pull (reveals the real error + backfills) ─────────────
if (!DO_PULL) {
  console.log(
    "ℹ️  Read-only. To run the live ReadyMode pull (reveals the real error, then backfills):\n" +
      "    deno run -A --env-file=env/local scripts/triage-readymode.ts --pull --date=06/16/2026 --max-pages=1\n" +
      "    (probe with --max-pages=1 first; drop it once login is confirmed to pull the full day)",
  );
  Deno.exit(0);
}

const fromDate = flags.get("date") ?? flags.get("from");
const toDate = flags.get("to") ?? fromDate;
const maxPagesPerDomain = flags.has("max-pages")
  ? Number(flags.get("max-pages"))
  : undefined;

console.log(
  `🎯 Live pull — from=${fromDate ?? "(yesterday ET)"} to=${
    toDate ?? "(=from)"
  } maxPages=${maxPagesPerDomain ?? "all"}`,
);
console.log(
  "   RM_USER must be logged OUT of the ReadyMode portal (single session).\n",
);

// Manual/triage pulls run mid-day, so take over any lingering human session
// instead of bouncing on "already logged in".
const result = await scrapeReadymode({
  fromDate,
  toDate,
  maxPagesPerDomain,
  takeoverIfLoggedIn: true,
});
console.log(
  `range=${result.fromDate}→${result.toDate}  totals=${
    JSON.stringify(result.totals)
  }`,
);
for (const dom of result.perDomain) {
  if (dom.error) {
    console.log(`  ❌ ${dom.domain}: ${dom.error}`);
  } else {
    console.log(
      `  ✅ ${dom.domain}: rows=${dom.rowsFetched} dispositions=${dom.dispositionsWritten} answeredUpserted=${dom.answeredUpserted} pages=${dom.pagesTotal}`,
    );
  }
}
const anyError = result.perDomain.some((d) => d.error);
console.log(
  anyError
    ? "\n⚠ At least one domain errored — the message above is the real cause (paste it if you want the root-cause fix)."
    : "\n✅ Pull succeeded. Re-run the report for the next day to see corrected numbers; the ⚠ flag clears once deployed.",
);
Deno.exit(anyError ? 1 : 0);
