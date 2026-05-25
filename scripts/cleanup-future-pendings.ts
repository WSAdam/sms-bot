// Delete every pending scheduledinjection whose eventTime is in the
// future, so they can be re-built fresh via scan-bookings (which now
// uses normalizeAppointmentTime at the write site — see
// shared/util/time.ts). Companion to scripts/cleanup-stale-pendings.ts,
// which handles the overdue + already-dialed cases.
//
// Discovery is dynamic: the script lists all pending docs and filters
// to (eventTime > now) in-memory. That keeps it safe to re-run — if
// the sweep has already fired some between runs, they're gone from
// the list automatically. Idempotent.
//
// Each future-dated doc is annotated with its risk class:
//   - tz-naive        : eventTime has no Z and no ±HH:MM offset (the
//                       bug we saw on 7164674843 — JS parses as UTC,
//                       fires ~4h early in EDT)
//   - far-future      : eventTime more than 90 days from now (likely
//                       a bad input, not a real appointment)
//   - clean           : eventTime looks fine but we're rebuilding via
//                       scan-bookings anyway for consistency
//
// Two modes:
//   - default (no flag) : print what WOULD be deleted, no writes
//   - --apply           : actually delete
//
// Usage:
//   deno run -A --env-file=env/local scripts/cleanup-future-pendings.ts [--apply]

import { parseArgs } from "@std/cli/parse-args";
import {
  scheduledInjectionDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const args = parseArgs(Deno.args, { boolean: ["apply", "dry-run"] });
const apply = !!args.apply;

const db = getFirestoreClient();
const nowMs = Date.now();
const FAR_FUTURE_DAYS = 90;

console.log(
  `🧹 cleanup-future-pendings: discovering future-dated pendings, apply=${apply}`,
);
console.log("");

const allPending = await db.list(scheduledInjectionsCollection, { limit: 1000 });

interface Target {
  phone10: string;
  eventTime: string;
  daysOut: number;
  reason: string;
}
const targets: Target[] = [];

for (const e of allPending) {
  const data = e.data as Record<string, unknown>;
  const phone10 = String(data.phone ?? e.id);
  const eventTime = typeof data.eventTime === "string" ? data.eventTime : "";
  const eventMs = new Date(eventTime).getTime();
  if (!Number.isFinite(eventMs)) continue;
  if (eventMs <= nowMs) continue;

  const daysOut = Math.round((eventMs - nowMs) / 86_400_000 * 10) / 10;
  const hasTzMarker = /Z$/.test(eventTime) ||
    /[+-]\d{2}:?\d{2}$/.test(eventTime);

  let reason: string;
  if (!hasTzMarker) {
    reason = `tz-naive (${eventTime}) — would fire ~4h early in EDT`;
  } else if (daysOut > FAR_FUTURE_DAYS) {
    reason = `far-future (${daysOut}d out) — likely bad input`;
  } else {
    reason = `clean (${daysOut}d out) — rebuild via scan-bookings for consistency`;
  }

  targets.push({ phone10, eventTime, daysOut, reason });
}

targets.sort((a, b) => a.daysOut - b.daysOut);

if (targets.length === 0) {
  console.log("✅ no future-dated pendings — nothing to do");
  Deno.exit(0);
}

console.log(`📊 found ${targets.length} future-dated pending(s):`);
console.log("");

let deleted = 0;
let failed = 0;

for (const t of targets) {
  if (!apply) {
    console.log(`  📋 ${t.phone10}  WOULD DELETE — ${t.reason}`);
    continue;
  }
  try {
    await db.delete(scheduledInjectionDocPath(t.phone10));
    console.log(`  🗑  ${t.phone10}  deleted — ${t.reason}`);
    deleted++;
  } catch (e) {
    console.log(`  ❌ ${t.phone10}  delete failed: ${(e as Error).message}`);
    failed++;
  }
}

console.log("");
console.log(
  `summary: ${apply ? "deleted" : "would-delete"}=${
    apply ? deleted : targets.length
  } failed=${failed}`,
);
if (!apply) {
  console.log("");
  console.log("Dry-run only. Re-run with --apply to actually delete:");
  console.log(
    "  deno run -A --env-file=env/local scripts/cleanup-future-pendings.ts --apply",
  );
  console.log("");
  console.log(
    "After delete, run scan-bookings (via /test page) to rebuild any that",
  );
  console.log("represent genuine future appointments.");
}
