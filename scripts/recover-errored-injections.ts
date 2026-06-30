// Recover appointments that the sweep ERRORED on and consumed without ever
// injecting into ReadyMode — the missing-(phone,firedAt)-index incident
// (2026-06-24..30) and any future terminal injection error.
//
// Why a dedicated script: the existing tools CAN'T recover these.
//   - /api/cron/trigger-single → fireSingle returns "not scheduled": the sweep
//     already deleted the scheduledinjection.
//   - /api/admin/repopulate-injections skips any phone with ANY injectionhistory
//     doc (incl. status="error"), so it refuses every errored phone.
//
// What it does: for each injectionhistory status="error" doc in range, re-create
// the scheduledinjection doc (with the ORIGINAL eventTime) so the every-minute
// cron sweep fires it again. The doc is written DIRECTLY (not via
// scheduleInjection) so the apptsBooked counters are NOT double-incremented —
// these bookings were already counted when first scheduled.
//
// Safe by construction:
//   - DRY-RUN by default. Pass --apply to actually write.
//   - Excluded/test phones are skipped.
//   - A phone that ALREADY has a pending scheduledinjection, or a LATER
//     status="success" history doc (already recovered / talk-now'd), is skipped.
//   - NO prod history is deleted. This relies on the deployed dedup fix that
//     IGNORES status!="success" docs, so the old error record does NOT block the
//     re-fire.
//
// PREREQUISITES (both must be true before --apply):
//   1. The (phone, firedAt) composite index is ENABLED
//      (firebase deploy --only firestore:indexes), so the re-fired dial's dedup
//      query works.
//   2. The dedup-guard fix is DEPLOYED. Under the OLD code the dedup counts the
//      error record as a recent fire and the sweep would SKIP the re-dial — run
//      this only after the fix ships.
//
// Usage:
//   deno run -A --env-file=env/local scripts/recover-errored-injections.ts            # dry-run
//   deno run -A --env-file=env/local scripts/recover-errored-injections.ts --apply    # write
//   ...optional: --since=2026-06-24  --all-errors  (default: only "requires an index" errors)

import { parseArgs } from "@std/cli/parse-args";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  injectionHistoryCollection,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type {
  FutureInjection,
  InjectionHistoryEntry,
} from "@shared/types/injection.ts";

const args = parseArgs(Deno.args, {
  boolean: ["apply", "all-errors"],
  string: ["since"],
  default: { apply: false, "all-errors": false, since: "2026-06-24" },
});

const apply = args.apply as boolean;
const allErrors = args["all-errors"] as boolean;
const sinceIso = new Date(`${args.since}T00:00:00.000Z`).toISOString();
const INDEX_ERROR_RE = /requires an index/i;

const db = getFirestoreClient();

console.log(
  `🔍 recover-errored-injections — mode=${apply ? "APPLY" : "DRY-RUN"} ` +
    `since=${sinceIso} filter=${
      allErrors ? "ALL errors" : "missing-index only"
    }`,
);

// 1. Pull every terminal injection error (single-field status index — no
//    composite needed). Errors are rare, so the 5000 cap is generous.
const errorDocs = await db.list(injectionHistoryCollection, {
  where: { field: "status", op: "==", value: "error" },
  limit: 5_000,
});

// 2. Build the cohort: one row per phone (most recent error), in range, of the
//    chosen error class, excluding test phones.
interface Cohort {
  phone: string;
  eventTime: string;
  scheduledAt: number;
  firedAt: string;
  error: string;
}
const byPhone = new Map<string, Cohort>();
let scannedErrors = 0;
for (const d of errorDocs) {
  const e = d.data as unknown as InjectionHistoryEntry;
  if (typeof e.firedAt !== "string" || e.firedAt < sinceIso) continue;
  const error = e.error ?? "";
  if (!allErrors && !INDEX_ERROR_RE.test(error)) continue;
  const phone = String(e.phone ?? "");
  if (!/^\d{10}$/.test(phone)) continue;
  if (isExcludedFromReporting(phone)) continue;
  scannedErrors++;
  const cur = byPhone.get(phone);
  if (!cur || cur.firedAt < e.firedAt) {
    byPhone.set(phone, {
      phone,
      eventTime: e.eventTime,
      scheduledAt: typeof e.scheduledAt === "number"
        ? e.scheduledAt
        : Date.now(),
      firedAt: e.firedAt,
      error,
    });
  }
}

console.log(
  `   ${errorDocs.length} error docs total → ${scannedErrors} in-scope → ` +
    `${byPhone.size} unique phones`,
);

// 3. For each candidate, skip if already pending or already recovered (a later
//    success). Otherwise re-create the scheduledinjection.
const recovered: string[] = [];
const skipped: Array<{ phone: string; reason: string }> = [];

for (const c of byPhone.values()) {
  const pending = await db.get(scheduledInjectionDocPath(c.phone));
  if (pending) {
    skipped.push({ phone: c.phone, reason: "already has pending injection" });
    continue;
  }
  // A later status="success" means it was already injected (recovered or
  // talk-now'd) after the error — don't re-dial.
  const hist = await db.list(injectionHistoryCollection, {
    where: { field: "phone", op: "==", value: c.phone },
    limit: 50,
  });
  const recoveredAlready = hist.some((h) => {
    const e = h.data as unknown as InjectionHistoryEntry;
    return e.status === "success" && typeof e.firedAt === "string" &&
      e.firedAt > c.firedAt;
  });
  if (recoveredAlready) {
    skipped.push({ phone: c.phone, reason: "already has a later success" });
    continue;
  }

  if (!apply) {
    console.log(
      `   [dry-run] would re-inject ${c.phone} eventTime=${c.eventTime} ` +
        `(errored ${c.firedAt})`,
    );
    recovered.push(c.phone);
    continue;
  }

  // Direct write — no apptsBooked counter bump (already counted at first book).
  const doc: FutureInjection = {
    phone: c.phone,
    eventTime: c.eventTime,
    scheduledAt: c.scheduledAt,
  };
  await db.set(
    scheduledInjectionDocPath(c.phone),
    doc as unknown as Record<string, unknown>,
  );
  console.log(`   ✅ re-scheduled ${c.phone} eventTime=${c.eventTime}`);
  recovered.push(c.phone);
}

console.log(
  `\n${
    apply ? "✅ APPLIED" : "🟡 DRY-RUN"
  }: ${recovered.length} re-injected, ` +
    `${skipped.length} skipped`,
);
for (const s of skipped) console.log(`   ⏭  ${s.phone} — ${s.reason}`);
if (!apply && recovered.length > 0) {
  console.log(
    `\nRe-run with --apply to write. The every-minute cron sweep will fire ` +
      `them; confirm via scripts/inspect-phone.ts <phone> ` +
      `(injectionhistory status=success + INJECT event + pointer IN_ODR).`,
  );
}
