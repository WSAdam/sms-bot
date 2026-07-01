// Manually schedule a single injection for a phone at a specific eventTime —
// for the "real booking, vague/relative time" case where a concrete slot gets
// pinned by hand (or you're re-pinning after a recovery placeholder). The
// every-minute cron sweep fires it at eventTime and injects into ODR.
//
// DRY-RUN by default; pass --apply to write. eventTime must be canonical UTC (Z)
// or offset-tagged (±HH:MM) — e.g. 3pm ET on Fri Jul 3 = 2026-07-03T15:00:00-04:00.
//
//   deno run -A --env-file=env/local scripts/schedule-injection.ts 2316836256 2026-07-03T15:00:00-04:00
//   deno run -A --env-file=env/local scripts/schedule-injection.ts 2316836256 2026-07-03T15:00:00-04:00 --apply

import {
  getScheduledInjection,
  scheduleInjection,
} from "@shared/services/injections/schedule.ts";

const apply = Deno.args.includes("--apply");
const [rawPhone, rawTime] = Deno.args.filter((a) => !a.startsWith("--"));
const phone = (rawPhone ?? "").replace(/\D/g, "").slice(-10);

if (!/^\d{10}$/.test(phone) || !rawTime) {
  console.error(
    "usage: schedule-injection.ts <10-digit-phone> <eventTimeISO> [--apply]",
  );
  Deno.exit(1);
}
if (!Number.isFinite(new Date(rawTime).getTime())) {
  console.error(`❌ invalid eventTime: ${rawTime}`);
  Deno.exit(1);
}
if (!/Z$|[+-]\d{2}:?\d{2}$/.test(rawTime)) {
  console.error(
    `❌ eventTime must be UTC (Z) or offset-tagged (±HH:MM): ${rawTime}`,
  );
  Deno.exit(1);
}

console.log(
  `🗓  schedule-injection phone=${phone} eventTime=${rawTime} mode=${
    apply ? "APPLY" : "DRY-RUN"
  }`,
);

const existing = await getScheduledInjection(phone) as
  | { eventTime?: string }
  | null;
if (existing) {
  console.log(
    `   ⚠️ already has a pending scheduledinjection (will be overwritten): eventTime=${existing.eventTime}`,
  );
}

if (!apply) {
  console.log(
    "   [dry-run] would scheduleInjection(...). Re-run with --apply.",
  );
  Deno.exit(0);
}

await scheduleInjection(phone, rawTime, false);
console.log(
  `   ✅ scheduled. The every-minute sweep fires it at eventTime and injects ` +
    `into ODR; confirm with scripts/inspect-phone.ts ${phone}.`,
);
