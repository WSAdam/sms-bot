// Runs the booking-scan service locally so we can preview / apply the
// catchup without deploying. Uses the same service the cron + endpoint
// use, so behavior is identical.
//
// Default: dry-run, yesterday-only (ET) window.
//
// Run:
//   deno task run-booking-scan                                          # dry-run, yesterday
//   deno task run-booking-scan -- --apply                               # apply, yesterday
//   deno task run-booking-scan -- --date=2026-05-05                     # specific ET day, dry-run
//   deno task run-booking-scan -- --date=2026-05-05 --apply             # specific ET day, apply
//   deno task run-booking-scan -- --date=2026-05-06 --apply --force     # re-process even if already recovered (deletes stale doc)
//   deno task run-booking-scan -- --days=3                              # rolling last 3 days, dry-run

import {
  scanConversationsForBookings,
  yesterdayEasternRange,
} from "@shared/services/conversations/booking-scan.ts";

const args = Deno.args;
const apply = args.includes("--apply");
const dryRun = !apply;
const force = args.includes("--force");
const daysArg = args.find((a) => a.startsWith("--days="));
const days = daysArg ? parseInt(daysArg.split("=")[1], 10) : 0;
const dateArg = args.find((a) => a.startsWith("--date="));
const dateStr = dateArg ? dateArg.split("=")[1] : null;

let fromIso: string;
let toIso: string | undefined;
if (dateStr) {
  // Specific ET day. Build a 24h window in UTC offset by ET (-04:00 EDT,
  // good enough — scan over-fetches by an hour at season boundaries).
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    console.error(`❌ --date must be YYYY-MM-DD (got: ${dateStr})`);
    Deno.exit(1);
  }
  fromIso = `${dateStr}T05:00:00.000Z`; // 00:00 EDT in UTC (close enough)
  toIso = new Date(new Date(fromIso).getTime() + 24 * 60 * 60 * 1000)
    .toISOString();
} else if (days > 0) {
  fromIso = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
  toIso = undefined;
} else {
  const r = yesterdayEasternRange();
  fromIso = r.fromIso;
  toIso = r.toIso;
}

console.log(`🔍 booking-scan`);
console.log(`   apply  = ${apply}`);
console.log(`   force  = ${force}`);
console.log(`   from   = ${fromIso}`);
console.log(`   to     = ${toIso ?? "(now)"}`);
console.log("");

const summary = await scanConversationsForBookings(
  fromIso,
  toIso,
  apply,
  force,
);

console.log("");
console.log("=== Proposals ===");
for (const p of summary.proposals) {
  const eta = p.eventTime
    ? `→ eventTime=${p.eventTime}`
    : `(no parseable time)`;
  console.log(
    `${p.phone10}  signal=${p.signal}@${p.signalAt.slice(11, 16)}  ${eta}`,
  );
  if (p.eventTimeSource) console.log(`    from: ${p.eventTimeSource}`);
  if (p.reason) console.log(`    reason: ${p.reason}`);
}

console.log("");
console.log("=== Summary ===");
console.log(`bland conversations: ${summary.blandConversations}`);
console.log(`proposed           : ${summary.proposed}`);
console.log(`applied            : ${summary.applied}`);
console.log(`skipped (existing) : ${summary.skippedExisting}`);
console.log(`skipped (no time)  : ${summary.skippedNoTime}`);
console.log(`errored            : ${summary.errored}`);
if (summary.errors.length > 0) {
  console.log(`errors:`);
  for (const e of summary.errors) console.log(`  ${e}`);
}
if (dryRun) console.log("(DRY RUN — no scheduledinjection writes)");

Deno.exit(0);
