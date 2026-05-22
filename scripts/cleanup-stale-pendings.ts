// Delete specific stale pending scheduledinjection docs. Built today
// to clear the backlog that piled up while the sweep cron was silently
// broken — 14 too-old + 5 just-talk-now'd (= 19 total). The 4 future-
// dated docs are LEFT in place; the sweep will fire them when it
// resumes working.
//
// Idempotent: re-running after delete is a no-op (db.delete on a
// missing doc is fine).
//
// Two modes:
//   - `--dry-run` (default): print what WOULD be deleted, no writes
//   - `--apply`            : actually delete
//
// The phone list is hardcoded — this is a today-only backfill, not a
// reusable tool. Don't extend it; if you need to delete a different
// set of docs in the future, copy this file and edit the list.
//
// Usage:
//   deno run -A --env-file=env/local scripts/cleanup-stale-pendings.ts [--apply]

import { parseArgs } from "@std/cli/parse-args";
import { scheduledInjectionDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

const args = parseArgs(Deno.args, { boolean: ["apply", "dry-run"] });
const apply = !!args.apply;

// Each entry: phone10 + the reason for deletion (printed in the dry-run
// output so it's clear why we picked these).
const TARGETS: Array<{ phone10: string; reason: string }> = [
  // Already-dialed via talk-now on 2026-05-18 (cleanup pre-existing).
  { phone10: "4434540226", reason: "already dialed via talk-now 2026-05-18" },

  // Too old to dial usefully (appointment 6+ days overdue).
  { phone10: "2103177633", reason: "15d overdue — appt May 7" },
  { phone10: "5072507507", reason: "15d overdue — appt May 7" },
  { phone10: "6037851937", reason: "15d overdue — appt May 7" },
  { phone10: "9044586992", reason: "15d overdue — appt May 7" },
  { phone10: "3308447807", reason: "14.8d overdue — appt May 7" },
  { phone10: "4048042599", reason: "12.9d overdue — appt May 9" },
  { phone10: "3368704919", reason: "12.8d overdue — appt May 9" },
  { phone10: "6093463025", reason: "9.9d overdue — appt May 12 (TZ-naive)" },
  { phone10: "3016554761", reason: "8.9d overdue — appt May 13" },
  { phone10: "5085176740", reason: "8.8d overdue — appt May 13 (TZ-naive)" },
  { phone10: "3366570911", reason: "8.0d overdue — appt May 14" },
  { phone10: "6026870856", reason: "7.2d overdue — appt May 15" },
  { phone10: "8644300031", reason: "7.0d overdue — appt May 15" },
  { phone10: "3132682948", reason: "6.2d overdue — appt May 16" },

  // Just talk-now'd via scripts/talk-now-batch.ts on 2026-05-22.
  { phone10: "2607600784", reason: "talk-now'd today 2026-05-22" },
  { phone10: "4102006909", reason: "talk-now'd today 2026-05-22" },
  { phone10: "7164674843", reason: "talk-now'd today 2026-05-22" },
  { phone10: "9198846501", reason: "talk-now'd today 2026-05-22" },
];

const db = getFirestoreClient();

console.log(
  `🧹 cleanup-stale-pendings: ${TARGETS.length} target(s), apply=${apply}`,
);
console.log("");

let toDelete = 0;
let alreadyGone = 0;
let failed = 0;

for (const { phone10, reason } of TARGETS) {
  const path = scheduledInjectionDocPath(phone10);
  const existing = await db.get(path);
  if (!existing) {
    console.log(`  ⏭  ${phone10}  already gone — ${reason}`);
    alreadyGone++;
    continue;
  }
  toDelete++;
  if (!apply) {
    console.log(`  📋 ${phone10}  WOULD DELETE — ${reason}`);
    continue;
  }
  try {
    await db.delete(path);
    console.log(`  🗑  ${phone10}  deleted — ${reason}`);
  } catch (e) {
    console.log(`  ❌ ${phone10}  delete failed: ${(e as Error).message}`);
    failed++;
  }
}

console.log("");
console.log(
  `summary: ${apply ? "deleted" : "would-delete"}=${
    toDelete - failed
  } alreadyGone=${alreadyGone} failed=${failed}`,
);
if (!apply) {
  console.log("");
  console.log(
    "Dry-run only. Re-run with --apply to actually delete:",
  );
  console.log(
    "  deno run -A --env-file=env/local scripts/cleanup-stale-pendings.ts --apply",
  );
}
