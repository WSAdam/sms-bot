// One-shot backfill: seed the sms-bot/injectedphones/byPhone index from
// existing scheduledinjections + injectionhistory data. Required because
// /api/guests/answered now reads ONLY the marker doc — any historical
// phone with no future inject would otherwise be incorrectly rejected as
// "not our lead".
//
// Idempotent: uses atomicCreate, so re-runs only insert phones that
// don't already have a marker.
//
// Sequencing: deploy this script + run it BEFORE deploying the new
// /api/guests/answered handler. See plan firestore-safety.md.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//   deno run -A --env-file=env/local scripts/backfill-injected-phones.ts \
//     [--dry-run] [--limit=N]

import { parseArgs } from "@std/cli/parse-args";
import {
  injectedPhoneDocPath,
  injectionHistoryCollection,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";

const args = parseArgs(Deno.args, {
  boolean: ["dry-run"],
  string: ["limit"],
  default: { limit: "200000" },
});

const limit = Number(args.limit);
if (!Number.isFinite(limit) || limit <= 0) {
  console.error(`❌ Invalid --limit=${args.limit}`);
  Deno.exit(1);
}

const dryRun = !!args["dry-run"];
const db = getFirestoreClient();

console.log(
  `🚀 backfill-injected-phones: scanning scheduledinjections + injectionhistory limit=${limit} dryRun=${dryRun}`,
);

const [pending, history] = await Promise.all([
  db.list(scheduledInjectionsCollection, { limit }),
  db.list(injectionHistoryCollection, { limit }),
]);

console.log(
  `🔍 fetched ${pending.length} pending + ${history.length} history docs`,
);

// Compute earliest+latest known event-times per phone so the seeded
// marker has meaningful `firstInjectedAt` / `lastInjectedAt` values.
interface PhoneTimes {
  first: string | null;
  last: string | null;
}
const seen = new Map<string, PhoneTimes>();

function observe(phone: string, ts: unknown) {
  if (isExcludedFromReporting(phone)) return;
  const iso = typeof ts === "string"
    ? ts
    : typeof ts === "number"
    ? new Date(ts).toISOString()
    : null;
  const cur = seen.get(phone) ?? { first: null, last: null };
  if (iso) {
    if (!cur.first || iso < cur.first) cur.first = iso;
    if (!cur.last || iso > cur.last) cur.last = iso;
  } else if (!seen.has(phone)) {
    seen.set(phone, cur);
  }
  seen.set(phone, cur);
}

for (const e of pending) {
  const d = e.data as Record<string, unknown>;
  const phone = String(d.phone ?? e.id);
  if (!/^\d{10}$/.test(phone)) continue;
  observe(phone, d.scheduledAt ?? d.eventTime);
}
for (const e of history) {
  const sep = e.id.indexOf("__");
  const d = e.data as Record<string, unknown>;
  const phone = String(d.phone ?? (sep > 0 ? e.id.slice(0, sep) : e.id));
  if (!/^\d{10}$/.test(phone)) continue;
  observe(phone, d.firedAt ?? d.scheduledAt);
}

console.log(`📊 unique phones to seed: ${seen.size}`);

if (dryRun) {
  const sample = Array.from(seen.entries()).slice(0, 10).map(([p, t]) =>
    `${p}(${t.first?.slice(0, 10) ?? "?"}→${t.last?.slice(0, 10) ?? "?"})`
  );
  console.log(`📋 [dry-run] sample: ${sample.join(", ")}`);
  Deno.exit(0);
}

let created = 0;
let existed = 0;
let processed = 0;
const total = seen.size;
const fallbackIso = new Date().toISOString();

for (const [phone, times] of seen) {
  processed++;
  const first = times.first ?? fallbackIso;
  const last = times.last ?? first;
  const r = await db.atomicCreate(injectedPhoneDocPath(phone), {
    phone,
    firstInjectedAt: first,
    lastInjectedAt: last,
  });
  if (r.created) {
    created++;
  } else {
    existed++;
    // Existing markers may have a stale lastInjectedAt — bump to the
    // latest known time. firstInjectedAt left alone (we don't want to
    // accidentally bump an earlier real value backward).
    await db.setMerge(injectedPhoneDocPath(phone), {
      lastInjectedAt: last,
    });
  }
  if (processed % 250 === 0) {
    console.log(
      `   …processed ${processed}/${total} (created=${created} existed=${existed})`,
    );
  }
}

console.log(`✅ done — created=${created} existed=${existed}`);
