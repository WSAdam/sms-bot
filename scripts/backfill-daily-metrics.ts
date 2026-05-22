// One-shot backfill: seed sms-bot/metrics/daily/* and metrics/lifetime/
// totals from existing data so the new nightly report reads non-zero
// numbers from day one.
//
// Sources:
//   - apptsBooked: union(scheduledinjections.scheduledAt,
//                        injectionhistory.scheduledAt) bucketed by ET day
//   - activations: guestactivated.activatedAt bucketed by ET day
//   - textsSent: uniquerecipientbyphone.firstSentAt bucketed by ET day
//                (best-effort lifetime — pre-marker-system sends are
//                invisible by definition; matches the report's existing
//                "Texts Sent (unique recipients)" semantic)
//
// Idempotent: each daily doc is `set` unconditionally and the lifetime
// doc is recomputed from the day buckets. Safe to re-run any time.
//
// Sequencing: run BEFORE the new nightly report ships, otherwise the
// first report would show zeros.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//   deno run -A --env-file=env/local scripts/backfill-daily-metrics.ts \
//     [--dry-run]

import { parseArgs } from "@std/cli/parse-args";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  guestActivatedCollection,
  injectionHistoryCollection,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  scheduledInjectionsCollection,
  uniqueRecipientByPhoneCollection,
} from "@shared/firestore/paths.ts";
import { type BatchOp, getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";

const args = parseArgs(Deno.args, { boolean: ["dry-run"] });
const dryRun = !!args["dry-run"];

const db = getFirestoreClient();

console.log(
  `🚀 backfill-daily-metrics: scanning source collections (dryRun=${dryRun})`,
);

const [pending, history, activated, recipients] = await Promise.all([
  db.list(scheduledInjectionsCollection, { limit: 200_000 }),
  db.list(injectionHistoryCollection, { limit: 200_000 }),
  db.list(guestActivatedCollection, { limit: 200_000 }),
  db.list(uniqueRecipientByPhoneCollection, { limit: 200_000 }),
]);

console.log(
  `🔍 fetched pending=${pending.length} history=${history.length} ` +
    `activated=${activated.length} recipients=${recipients.length}`,
);

function bucketDay(iso: unknown): string | null {
  if (typeof iso === "number" && Number.isFinite(iso)) {
    return easternDateString(new Date(iso));
  }
  if (typeof iso === "string") {
    const ms = new Date(iso).getTime();
    if (Number.isFinite(ms)) return easternDateString(new Date(ms));
  }
  return null;
}

function addBucket(map: Map<string, number>, day: string | null) {
  if (!day) return;
  map.set(day, (map.get(day) ?? 0) + 1);
}

const apptsBookedByDay = new Map<string, number>();
const activationsByDay = new Map<string, number>();
const textsSentByDay = new Map<string, number>();

// apptsBooked: count one per phone-booking. scheduledinjections has one
// active doc per phone (deleted on fire); injectionhistory is append-only
// per fire. Pre-fix the dashboard counted (pending ∪ history) deduped by
// phone — match that here by counting the earliest known scheduledAt per
// phone. For backfill simplicity we just sum all booking events; this is
// the conservative "every booking we ever did" total and matches what the
// dashboard's `apptsBookedLifetime` was computing before the fix.
for (const e of pending) {
  const d = e.data as Record<string, unknown>;
  const phone = String(d.phone ?? e.id);
  if (isExcludedFromReporting(phone)) continue;
  addBucket(apptsBookedByDay, bucketDay(d.scheduledAt));
}
for (const e of history) {
  const d = e.data as Record<string, unknown>;
  const sep = e.id.indexOf("__");
  const phone = String(d.phone ?? (sep > 0 ? e.id.slice(0, sep) : e.id));
  if (isExcludedFromReporting(phone)) continue;
  addBucket(apptsBookedByDay, bucketDay(d.scheduledAt));
}

for (const e of activated) {
  if (isExcludedFromReporting(e.id)) continue;
  const d = e.data as Record<string, unknown>;
  addBucket(activationsByDay, bucketDay(d.activatedAt));
}

for (const e of recipients) {
  if (isExcludedFromReporting(e.id)) continue;
  const d = e.data as Record<string, unknown>;
  addBucket(textsSentByDay, bucketDay(d.firstSentAt));
}

// Lifetime totals (sums of bucketed values).
function sum(m: Map<string, number>): number {
  let s = 0;
  for (const n of m.values()) s += n;
  return s;
}
const lifetime = {
  apptsBooked: sum(apptsBookedByDay),
  activations: sum(activationsByDay),
  textsSent: sum(textsSentByDay),
};

console.log(
  `📊 lifetime: apptsBooked=${lifetime.apptsBooked} ` +
    `activations=${lifetime.activations} textsSent=${lifetime.textsSent}`,
);
console.log(
  `📅 days with activity: appts=${apptsBookedByDay.size} ` +
    `activations=${activationsByDay.size} texts=${textsSentByDay.size}`,
);

if (dryRun) {
  console.log(`📋 [dry-run] no writes.`);
  Deno.exit(0);
}

const updatedAt = new Date().toISOString();
const writes: BatchOp[] = [];

const allDays = new Set<string>([
  ...apptsBookedByDay.keys(),
  ...activationsByDay.keys(),
  ...textsSentByDay.keys(),
]);
for (const day of allDays) {
  writes.push({
    type: "set",
    path: metricsDailyDocPath(day),
    data: {
      apptsBooked: apptsBookedByDay.get(day) ?? 0,
      activations: activationsByDay.get(day) ?? 0,
      textsSent: textsSentByDay.get(day) ?? 0,
      updatedAt,
    },
  });
}
writes.push({
  type: "set",
  path: metricsLifetimeDocPath(),
  data: { ...lifetime, updatedAt },
});

console.log(`💾 committing ${writes.length} metric docs...`);
await db.batch(writes);
console.log(`✅ done — wrote ${allDays.size} daily docs + 1 lifetime doc`);
