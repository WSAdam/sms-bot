// Read-only pipeline diagnostic. Walks the last N days and prints a
// per-day breakdown of every stage in the SMS-bot funnel so it's
// obvious where conversations / bookings / activations went missing
// (e.g. the 16-day activation gap from cron 502s, or any earlier
// silent drops we haven't noticed).
//
// Per ET day, the script counts:
//   - conversations written (storeMessage writes, bucketed by timestamp)
//   - new scheduledinjections (bucketed by scheduledAt)
//   - injectionhistory fires (bucketed by firedAt)
//   - guestactivated writes (bucketed by activatedAt)
//
// Then it flags "suspected gap" days:
//   - conversations=0 on a weekday → reseed cron likely failed
//   - scheduledinjections=0 AND conversations>50 → booking-scan suspect
//   - guestactivated=0 for 3+ consecutive days → sale-match suspect
//
// And surfaces a "Phones with booking but no activation" table —
// phones with a fired injection in the window but no guestactivated
// doc. These are candidates QB might have closed but we never matched.
//
// Outputs a markdown table to stdout + a JSON dump at
// data/pipeline-diagnosis-{YYYY-MM-DD}.json for follow-up scripting.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//     deno run -A --env-file=env/local scripts/diagnose-pipeline.ts \
//     [--days=30]

import { parseArgs } from "@std/cli/parse-args";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  conversationsCollection,
  guestActivatedCollection,
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";

const args = parseArgs(Deno.args, {
  string: ["days"],
  default: { days: "30" },
});
const days = Math.max(1, Math.min(180, Number(args.days)));

const db = getFirestoreClient();
console.log(`🔍 diagnose-pipeline: scanning last ${days} ET days`);

// ET day window. Walk backwards from today so cutoffMs is N days back
// at 00:00 ET.
const todayEt = easternDateString();
const [ty, tm, td] = todayEt.split("-").map((s) => Number(s));
const cutoffEt = new Date(Date.UTC(ty, tm - 1, td));
cutoffEt.setUTCDate(cutoffEt.getUTCDate() - (days - 1));
const cutoffMs = cutoffEt.getTime() - 4 * 60 * 60 * 1000; // shift to ET 00:00

// Bulk-load everything once. Each collection is small (<50k) so the
// total cost is bounded — same carve-out justification as sale-match.
const BULK_LIMIT = 200_000;
const [convos, pending, history, activated] = await Promise.all([
  db.list(conversationsCollection, { limit: BULK_LIMIT }),
  db.list(scheduledInjectionsCollection, { limit: BULK_LIMIT }),
  db.list(injectionHistoryCollection, { limit: BULK_LIMIT }),
  db.list(guestActivatedCollection, { limit: BULK_LIMIT }),
]);
console.log(
  `📊 loaded: conversations=${convos.length} pending=${pending.length} history=${history.length} activated=${activated.length}`,
);

interface DayRow {
  conversations: number;
  scheduledinjections: number;
  injectionhistoryFires: number;
  activations: number;
}
const byDay = new Map<string, DayRow>();
function bucket(day: string | null): DayRow | null {
  if (!day) return null;
  if (!byDay.has(day)) {
    byDay.set(day, {
      conversations: 0,
      scheduledinjections: 0,
      injectionhistoryFires: 0,
      activations: 0,
    });
  }
  return byDay.get(day)!;
}
function dayOf(iso: unknown): string | null {
  if (typeof iso === "number") return easternDateString(new Date(iso));
  if (typeof iso !== "string") return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t) || t < cutoffMs) return null;
  return easternDateString(new Date(t));
}

for (const e of convos) {
  const m = e.data as { phoneNumber?: string; timestamp?: string };
  if (m.phoneNumber && isExcludedFromReporting(m.phoneNumber)) continue;
  const d = bucket(dayOf(m.timestamp));
  if (d) d.conversations++;
}
for (const e of pending) {
  const data = e.data as Record<string, unknown>;
  const phone = String(data.phone ?? e.id);
  if (isExcludedFromReporting(phone)) continue;
  const d = bucket(dayOf(data.scheduledAt));
  if (d) d.scheduledinjections++;
}
for (const e of history) {
  const data = e.data as Record<string, unknown>;
  const sep = e.id.indexOf("__");
  const phone = String(data.phone ?? (sep > 0 ? e.id.slice(0, sep) : e.id));
  if (isExcludedFromReporting(phone)) continue;
  const d = bucket(dayOf(data.firedAt));
  if (d) d.injectionhistoryFires++;
}
for (const e of activated) {
  if (isExcludedFromReporting(e.id)) continue;
  const data = e.data as Record<string, unknown>;
  const d = bucket(dayOf(data.activatedAt));
  if (d) d.activations++;
}

// Build the day list (every day in the window, even zero days).
const dayList: string[] = [];
for (let i = 0; i < days; i++) {
  const dt = new Date(cutoffMs + i * 86_400_000);
  dayList.push(easternDateString(dt));
}

// Gap detection. Suspected sale-match gap = 3+ consecutive days of
// zero activations. We don't flag weekends since QB closures vary.
const activationStreak: number[] = []; // indices of "zero activation" days
const saleMatchGapDays = new Set<string>();
let zeroRun = 0;
let zeroStart = -1;
dayList.forEach((day, idx) => {
  const row = byDay.get(day);
  const acts = row?.activations ?? 0;
  if (acts === 0) {
    if (zeroRun === 0) zeroStart = idx;
    zeroRun++;
  } else {
    if (zeroRun >= 3) {
      for (let i = zeroStart; i < zeroStart + zeroRun; i++) {
        saleMatchGapDays.add(dayList[i]);
        activationStreak.push(i);
      }
    }
    zeroRun = 0;
    zeroStart = -1;
  }
});
if (zeroRun >= 3) {
  for (let i = zeroStart; i < zeroStart + zeroRun; i++) {
    saleMatchGapDays.add(dayList[i]);
  }
}

// Print the table.
console.log("");
console.log(
  "| Day        | conv | sched | fires | activ | suspected gap |",
);
console.log(
  "|------------|------|-------|-------|-------|---------------|",
);
const gapSummary = {
  reseedGapDays: [] as string[],
  bookingScanGapDays: [] as string[],
  saleMatchGapDays: [] as string[],
};
for (const day of dayList) {
  const row = byDay.get(day) ?? {
    conversations: 0,
    scheduledinjections: 0,
    injectionhistoryFires: 0,
    activations: 0,
  };
  const dow = new Date(`${day}T12:00:00-04:00`).getUTCDay(); // 0=Sun, 6=Sat (in ET noon UTC)
  const isWeekend = dow === 0 || dow === 6;
  const gaps: string[] = [];
  if (row.conversations === 0 && !isWeekend) {
    gaps.push("reseed?");
    gapSummary.reseedGapDays.push(day);
  }
  if (row.scheduledinjections === 0 && row.conversations > 50) {
    gaps.push("booking-scan?");
    gapSummary.bookingScanGapDays.push(day);
  }
  if (saleMatchGapDays.has(day)) {
    gaps.push("sale-match?");
    gapSummary.saleMatchGapDays.push(day);
  }
  console.log(
    `| ${day} | ${String(row.conversations).padStart(4)} | ${
      String(row.scheduledinjections).padStart(5)
    } | ${String(row.injectionhistoryFires).padStart(5)} | ${
      String(row.activations).padStart(5)
    } | ${gaps.join(", ") || "—"} |`,
  );
}

// Phones with booking-in-window but no activation. These are
// candidates QB might have closed (and the sale-match cron missed),
// OR genuine no-shows (most of them). Cross-check against the next QB
// report run to confirm.
const activatedSet = new Set<string>(activated.map((e) => e.id));
const bookedNotActivated: Array<
  { phone10: string; firedAt: string; eventTime: string | null }
> = [];
for (const e of history) {
  const data = e.data as Record<string, unknown>;
  const sep = e.id.indexOf("__");
  const phone = String(data.phone ?? (sep > 0 ? e.id.slice(0, sep) : e.id));
  if (isExcludedFromReporting(phone)) continue;
  if (activatedSet.has(phone)) continue;
  const firedAt = typeof data.firedAt === "string" ? data.firedAt : "";
  const firedMs = new Date(firedAt).getTime();
  if (!Number.isFinite(firedMs) || firedMs < cutoffMs) continue;
  bookedNotActivated.push({
    phone10: phone,
    firedAt,
    eventTime: typeof data.eventTime === "string" ? data.eventTime : null,
  });
}
bookedNotActivated.sort((a, b) => (a.firedAt < b.firedAt ? 1 : -1));

console.log("");
console.log(
  `🟡 Phones with fired injection in last ${days}d but no guestactivated doc: ${bookedNotActivated.length}`,
);
console.log(
  "    (these are candidates the next QB sale-match might claim — or genuine no-shows)",
);
console.log("");
const preview = bookedNotActivated.slice(0, 20);
for (const r of preview) {
  console.log(
    `    ${r.phone10}  fired=${r.firedAt.slice(0, 10)}  appt=${
      (r.eventTime ?? "?").slice(0, 10)
    }`,
  );
}
if (bookedNotActivated.length > preview.length) {
  console.log(
    `    … (+${bookedNotActivated.length - preview.length} more in JSON)`,
  );
}

// Dump the full state to JSON for follow-up scripting.
try {
  await Deno.mkdir("data", { recursive: true });
} catch {
  // dir exists
}
const reportDate = easternDateString();
const outPath = `data/pipeline-diagnosis-${reportDate}.json`;
const dump = {
  generatedAt: new Date().toISOString(),
  windowDays: days,
  dayRows: dayList.map((day) => ({
    day,
    ...(byDay.get(day) ?? {
      conversations: 0,
      scheduledinjections: 0,
      injectionhistoryFires: 0,
      activations: 0,
    }),
  })),
  gapSummary,
  bookedNotActivated,
};
await Deno.writeTextFile(outPath, JSON.stringify(dump, null, 2));
console.log("");
console.log(`📁 wrote ${outPath}`);
console.log(
  `   reseedGapDays=${gapSummary.reseedGapDays.length} bookingScanGapDays=${gapSummary.bookingScanGapDays.length} saleMatchGapDays=${gapSummary.saleMatchGapDays.length}`,
);
