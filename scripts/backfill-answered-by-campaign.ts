// Hand-walk backfill of "answered" for our leads, via a CAMPAIGN-FILTERED ODR
// call-log pull. Our leads live in the "Appointments" campaign — its call-log
// REPORT id is the integer 81 (NOT the inject-channel code "cuCyA6Xoeu88" from
// campaigns.ts; that code is for the lead-add API and the call_log report
// silently IGNORES it, returning ALL campaigns ≈ 79 pages/day). Pass the integer
// report id via --campaign (default 81).
//
// ANSWERED is decided by the SHARED isAnsweredCall gate (single-sourced from the
// live import so this backfill can't drift): a non-No-Answer disposition with
// >= 60s of talk, OR a "No Answer" that nonetheless ran >= 180s (a long
// No-Answer is almost always a mis-disposition — a real conversation the agent
// fat-fingered). Re-run this after the 3-min No-Answer rule lands to pick up the
// long No-Answer calls we previously dropped.
//
// Rate cap = ONE DAY of call data per minute (NOT per page). So: pull a full day
// at normal page speed (50ms between pages, same as the live cron), then wait
// >= --day-spacing-ms (default 60000) before the next day. Weekends skipped
// (dialer is weekdays-only). One login (with takeover) per day for a fresh
// session. NOT a cron — you run it by hand, once.
//
// ADDITIVE + non-destructive: only writes guestanswered for phones NOT already
// present. Never overwrites/deletes — your manually-verified answers are safe.
//
// Dry-run (read-only, reports what it WOULD add):
//   deno run -A --env-file=env/local scripts/backfill-answered-by-campaign.ts \
//     --from=06/12/2026 --to=06/16/2026
// Apply (additive writes), full history:
//   deno run -A --env-file=env/local scripts/backfill-answered-by-campaign.ts \
//     --from=02/10/2026 --to=06/16/2026 --apply

import {
  login,
  parseDurationSeconds,
  parseEtTimeToIso,
} from "@shared/services/readymode/portal-client.ts";
import { isAnsweredCall } from "@shared/services/readymode/import-dispositions.ts";
import { getRmCreds } from "@shared/services/readymode/auth.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import {
  guestAnsweredCollection,
  guestAnsweredDocPath,
} from "@shared/firestore/paths.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";

const flags = new Map<string, string>();
const bools = new Set<string>();
for (const a of Deno.args) {
  if (!a.startsWith("--")) continue;
  const [k, v] = a.slice(2).split("=");
  if (v === undefined) bools.add(k);
  else flags.set(k, v);
}
const FROM = flags.get("from"); // YYYY-MM-DD or MM/DD/YYYY
const TO = flags.get("to") ?? FROM;
const CAMPAIGN = flags.get("campaign") ?? "81"; // Appointments — call-log REPORT id (integer), NOT the inject channel code
const DAY_SPACING_MS = flags.has("day-spacing-ms")
  ? Number(flags.get("day-spacing-ms"))
  : 60_000;
const MAX_PAGES = flags.has("max-pages") ? Number(flags.get("max-pages")) : 0;
const APPLY = bools.has("apply");
if (!FROM) {
  console.error("Need --from (MM/DD/YYYY or YYYY-MM-DD). See header.");
  Deno.exit(1);
}

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36";
const REPORT_TYPES = [
  "6",
  "30",
  "31",
  "28",
  "29",
  "11",
  "13",
  "9",
  "14",
  "2",
  "21",
  "3",
  "8",
  "User,%",
  "Queue,3",
  "Queue,10",
  "Queue,15",
];
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

// parseDurationSeconds + isAnsweredCall are imported (single-sourced from
// portal-client.ts / import-dispositions.ts) so this backfill can't drift from
// the live import path.
// Normalize FROM/TO to a UTC-midnight Date for iteration.
function toDate(s: string): Date {
  if (s.includes("/")) {
    const [m, d, y] = s.split("/").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}
function mmddyyyy(dt: Date): string {
  return `${String(dt.getUTCMonth() + 1).padStart(2, "0")}/${
    String(dt.getUTCDate()).padStart(2, "0")
  }/${dt.getUTCFullYear()}`;
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const domain = DialerDomain.ODR;
const baseUrl = `https://${domain}.readymode.com`;
const creds = getRmCreds(domain);

function updateUrl(dayMdy: string, page: number): string {
  const p = new URLSearchParams();
  p.set("update", "1");
  for (const t of REPORT_TYPES) p.append("report[types][]", t);
  p.set("report[time_from_d]", dayMdy);
  p.set("report[time_from_dateonly]", "1");
  p.set("report[time_to_d]", dayMdy);
  p.set("report[time_to_dateonly]", "1");
  p.set("report[restrict_uid]", "0");
  p.set("report[restrict_campaign]", CAMPAIGN);
  p.set("report[restrict_batch]", "0");
  p.set("report[sourceFilter]", "-1");
  p.set("report[durationFilter]", "-1");
  p.set("report[callTypeFilter]", "_");
  p.set("report[page]", String(page));
  return `${baseUrl}/CCS%20Reports/call_log/update?${p.toString()}`;
}

// Pull one day's campaign calls (login + all pages at normal speed).
async function pullDay(dayMdy: string) {
  const session = await login(domain, creds.user, creds.pass, {
    takeoverIfLoggedIn: true,
  });
  const common = {
    "user-agent": UA,
    cookie: session.cookieHeader,
    "x-requested-with": "XMLHttpRequest",
    referer: `${baseUrl}/`,
  };
  await (await fetch(`${baseUrl}/CCS%20Reports/call_log`, {
    method: "POST",
    headers: { ...common, "content-length": "0" },
  })).body?.cancel();
  const rows: {
    phone10: string;
    callLogId: string;
    disposition: string;
    rmTime: string;
    durationSecs: number;
  }[] = [];
  let pagesTotal = 0, page = 0;
  while (true) {
    const res = await fetch(updateUrl(dayMdy, page), {
      headers: { ...common, accept: "application/json" },
    });
    const text = await res.text();
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text);
    } catch {
      throw new Error(`page ${page} non-JSON: ${text.slice(0, 120)}`);
    }
    if (page === 0) pagesTotal = Number(json.pages ?? 0);
    const results = (json.results ?? {}) as Record<string, unknown>;
    for (const v of Object.values(results)) {
      const r = v as Record<string, unknown>;
      // File is "<name...> (XXX) XXX-XXXX" — match the formatted phone, don't
      // strip-all-digits (names can contain digits).
      const m = String(r.File ?? "").match(/\((\d{3})\)\s*(\d{3})-(\d{4})/);
      const phone10 = m ? `${m[1]}${m[2]}${m[3]}` : "";
      const callLogId = String(r.id ?? "");
      if (!phone10 || !callLogId) continue;
      rows.push({
        phone10,
        callLogId,
        disposition: String(r.Type ?? ""),
        rmTime: String(r.Time ?? ""),
        durationSecs: parseDurationSeconds(String(r.Calltime ?? "")),
      });
    }
    page++;
    if (page >= pagesTotal) break;
    if (MAX_PAGES && page >= MAX_PAGES) break;
    await sleep(50); // normal in-day page spacing (same as the live cron)
  }
  return { rows, pagesTotal };
}

console.log(
  `🎯 campaign backfill — ${CAMPAIGN} — ${FROM}→${TO} — apply=${APPLY} — ≤1 day/${DAY_SPACING_MS}ms`,
);
const db = getFirestoreClient();
const existing = await db.list(guestAnsweredCollection, { limit: 200_000 });
const have = new Set(
  existing.map((e) =>
    String((e.data as Record<string, unknown>).phone10 ?? e.id)
  ),
);
console.log(`existing guestanswered: ${have.size}\n`);

const start = toDate(FROM), end = toDate(TO!);
let totalRows = 0, totalNew = 0, daysPulled = 0;
for (const d = new Date(start); d <= end; d.setUTCDate(d.getUTCDate() + 1)) {
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) continue; // weekends: dialer off
  const mdy = mmddyyyy(d);
  daysPulled++;
  let day;
  try {
    day = await pullDay(mdy);
  } catch (e) {
    console.log(
      `  ✗ ${mdy} (${DOW[dow]}) pull failed: ${(e as Error).message}`,
    );
    continue;
  }
  // answered (non-No-Answer, non-excluded) — campaign already gates to our
  // leads. Track the EARLIEST answered call per phone (by ISO call time) so the
  // guestanswered doc carries a real `answeredAt` — the same field + shape the
  // live import writes, and the bucketing key backfill-daily-answered.ts needs
  // to attribute the answer to its ET day (a doc without answeredAt is silently
  // dropped from the daily + lifetime recompute).
  const earliestAnswered = new Map<string, { iso: string; dispo: string }>();
  for (const r of day.rows) {
    // ANSWERED is decided by the shared isAnsweredCall gate (60s for normal
    // dispositions, 180s for a "No Answer" mis-disposition). Excluded test
    // phones never count.
    if (
      isExcludedFromReporting(r.phone10) ||
      !isAnsweredCall(r.disposition, r.durationSecs)
    ) {
      continue;
    }
    const iso = parseEtTimeToIso(r.rmTime, mdy);
    const cur = earliestAnswered.get(r.phone10);
    if (!cur || iso < cur.iso) {
      earliestAnswered.set(r.phone10, { iso, dispo: r.disposition });
    }
  }
  const freshToday = [...earliestAnswered.keys()].filter((p) => !have.has(p));
  totalRows += day.rows.length;
  if (APPLY) {
    // ADDITIVE: write ONLY the new answered guestanswered docs (no bulk
    // calldisposition writes — that's ~1M writes for no metric benefit).
    const ops = [];
    for (const p of freshToday) {
      have.add(p);
      const a = earliestAnswered.get(p)!;
      ops.push({
        type: "set" as const,
        path: guestAnsweredDocPath(p),
        data: {
          phone10: p,
          answered: true,
          answeredAt: a.iso,
          source: "campaign-backfill",
          lastDisposition: a.dispo,
          backfillDay: mdy,
        },
      });
    }
    if (ops.length) await db.batch(ops);
  } else for (const p of freshToday) have.add(p); // simulate so cross-day dedupe is accurate in dry-run
  totalNew += freshToday.length;
  console.log(
    `  ${mdy} (${
      DOW[dow]
    }): ${day.rows.length} calls/${day.pagesTotal}pg, answered=${earliestAnswered.size}, NEW=${freshToday.length}  [running new: ${totalNew}]`,
  );
  await sleep(DAY_SPACING_MS); // ≤ 1 day of data per minute
}
console.log(
  `\n${
    APPLY ? "✅ APPLIED" : "ℹ️ DRY"
  } — days=${daysPulled} rows=${totalRows} NEW answered phones=${totalNew}`,
);
console.log(
  APPLY
    ? `guestanswered grew by ${totalNew} (existing untouched).`
    : `re-run with --apply to add these ${totalNew}.`,
);
