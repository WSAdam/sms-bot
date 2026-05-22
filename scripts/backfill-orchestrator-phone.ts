// One-shot backfill: write a `phone` field on every orchestratorevents doc
// so getEvents can do a database-side where("phone", "==", phone) instead
// of listing the whole collection and filtering by doc-ID prefix.
//
// Doc IDs are `${phone10}__${timestamp}` — we extract phone10 from the ID
// and stamp it as a field. Idempotent: re-runs leave existing `phone`
// fields alone (set with merge).
//
// Required because the new `where` filter in getEvents would otherwise
// miss every historical doc that predates the field.
//
// Usage:
//   FIRESTORE_LIST_WARN_THRESHOLD=1000000 \
//   deno run -A --env-file=env/local scripts/backfill-orchestrator-phone.ts \
//     [--dry-run] [--limit=N]
//
// Default limit is 200_000 — well above the realistic collection size,
// but bumpable via --limit for safety.

import { parseArgs } from "@std/cli/parse-args";
import { orchestratorEventsCollection } from "@shared/firestore/paths.ts";
import { type BatchOp, getFirestoreClient } from "@shared/firestore/wrapper.ts";

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
  `🚀 backfill-orchestrator-phone: listing ${orchestratorEventsCollection} limit=${limit} dryRun=${dryRun}`,
);

const all = await db.list(orchestratorEventsCollection, { limit });
console.log(`🔍 fetched ${all.length} docs`);

let stamped = 0;
let skipped = 0;
let malformed = 0;
const writes: BatchOp[] = [];

for (const e of all) {
  const sep = e.id.indexOf("__");
  if (sep <= 0) {
    malformed++;
    continue;
  }
  const phone = e.id.slice(0, sep);
  if (!/^\d{10}$/.test(phone)) {
    malformed++;
    continue;
  }
  const existingPhone = (e.data as { phone?: unknown }).phone;
  if (typeof existingPhone === "string" && existingPhone === phone) {
    skipped++;
    continue;
  }
  writes.push({
    type: "set",
    path: `${orchestratorEventsCollection}/${e.id}`,
    data: { ...e.data, phone },
  });
  stamped++;
}

if (dryRun) {
  console.log(
    `📋 [dry-run] would stamp=${stamped} alreadyStamped=${skipped} malformed=${malformed}`,
  );
  Deno.exit(0);
}

console.log(`💾 committing ${writes.length} stamps...`);
await db.batch(writes);
console.log(
  `✅ done — stamped=${stamped} alreadyStamped=${skipped} malformed=${malformed}`,
);
