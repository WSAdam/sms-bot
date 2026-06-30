// Cron sweep: find scheduled injections whose eventTime <= now, fire each by
// calling the queue/trigger handler logic, write history, delete the
// scheduled doc.

import {
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  FutureInjection,
  InjectionHistoryEntry,
} from "@shared/types/injection.ts";
import { injectionHistoryDocId } from "@shared/util/id.ts";
import { handleDelayedInjection } from "@shared/services/orchestrator/queue.ts";
import { pushInjectionFailure } from "@scheduling/domain/data/canary-alert/mod.ts";

export interface SweepResult {
  scanned: number;
  fired: number;
  skipped: number;
  // Phones whose dial threw but were KEPT for a future retry (attempts <
  // MAX_INJECTION_ATTEMPTS) — delay-not-loss, not yet a terminal failure.
  retrying: number;
  // Terminal failures only: a dial that errored AND exhausted its retries, or
  // a batch write that failed. These are what the canary alert surfaces.
  errors: Array<{ phone: string; error: string }>;
}

// A dial that THROWS is retried on subsequent every-minute sweeps instead of
// being consumed. After this many failed attempts the sweep gives up: it writes
// a terminal injectionhistory status="error" (watched by the canary
// injection-failure alert) and deletes the scheduledinjection. Until then the
// appointment is delay-not-loss — never silently dropped, the way the missing
// (phone, firedAt) index dropped every booking Jun 24–30 2026.
export const MAX_INJECTION_ATTEMPTS = 5;

export async function sweepScheduledInjections(
  firedBy: "cron" | "manual" = "cron",
  client: FirestoreClient = getFirestoreClient(),
): Promise<SweepResult> {
  // Filter at the database to eventTime <= now. Per-tick read cost drops
  // from "size of scheduledinjections" to "number of due appointments",
  // which is usually 0. See firestore-safety.md.
  const dueDocs = await client.list(scheduledInjectionsCollection, {
    where: {
      field: "eventTime",
      op: "<=",
      value: new Date().toISOString(),
    },
    orderBy: { field: "eventTime", dir: "asc" },
    limit: 50,
  });
  const due: Array<{ phone: string; injection: FutureInjection }> = dueDocs.map(
    (e) => ({ phone: e.id, injection: e.data as unknown as FutureInjection }),
  );

  const errors: SweepResult["errors"] = [];
  let fired = 0;
  let skipped = 0;
  let retrying = 0;

  for (const { phone, injection } of due) {
    const firedAt = new Date().toISOString();
    let status: InjectionHistoryEntry["status"] = "success";
    let errorMsg: string | undefined;
    let skipReason: string | undefined;

    try {
      const r = await handleDelayedInjection(phone);
      if (r.skipped) {
        status = "skipped";
        skipReason = r.reason;
        skipped++;
      } else {
        fired++;
        console.log(`[sweep] ✅ fired phone=${phone}`);
      }
    } catch (e) {
      status = "error";
      errorMsg = (e as Error).message;
      // Log per-phone so the failure is visible in real time. The aggregate
      // `⏰ sweep: ... errors=N` line only tells you a count; you used to have
      // to crack open injectionhistory to learn which phone and why.
      console.error(`[sweep] ❌ phone=${phone} → ${errorMsg}`);
    }

    // ─── Error path: DELAY-NOT-LOSS ─────────────────────────────────────────
    // A dial that THREW must NOT consume the appointment. Pre-fix, ANY error
    // wrote status="error" and deleted the scheduledinjection in one batch — so
    // a single missing-index throw silently lost the booking forever (incident
    // 2026-06-24..30). Now we KEEP the doc and retry on the next sweep, bumping
    // `attempts`. Only after MAX_INJECTION_ATTEMPTS do we give up: write the
    // terminal status="error" history row (the canary injection-failure alert
    // watches these) and delete the doc.
    if (status === "error") {
      const attempts = (injection.attempts ?? 0) + 1;
      if (attempts < MAX_INJECTION_ATTEMPTS) {
        retrying++;
        console.warn(
          `[sweep] ↻ retry phone=${phone} attempt=${attempts}/${MAX_INJECTION_ATTEMPTS} ` +
            `(keeping scheduledinjection) → ${errorMsg}`,
        );
        // Best-effort bookkeeping. Even if this write fails we did NOT delete
        // the doc, so the next sweep retries regardless — never a lost booking.
        try {
          await client.setMerge(scheduledInjectionDocPath(phone), {
            attempts,
            lastError: errorMsg ?? "unknown",
            lastAttemptAt: firedAt,
          });
        } catch (e2) {
          console.error(
            `[sweep] ⚠️ retry bookkeeping write failed phone=${phone} → ${
              (e2 as Error).message
            }`,
          );
        }
        continue; // try again next minute — no history written, no delete
      }

      // Exhausted retries → terminal failure. Record the error ONCE here; if the
      // batch below ALSO fails we must not double-count the same phone.
      errors.push({ phone, error: errorMsg ?? "unknown" });
      console.error(
        `[sweep] ✖ giving up phone=${phone} after ${attempts} attempts → ${errorMsg}`,
      );
      const terminal: InjectionHistoryEntry = {
        phone,
        eventTime: injection.eventTime,
        scheduledAt: injection.scheduledAt,
        firedAt,
        firedBy,
        status: "error",
        attempts,
        ...(injection.isTest ? { isTest: true } : {}),
        ...(errorMsg ? { error: errorMsg } : {}),
      };
      try {
        await client.batch([
          {
            type: "set",
            path: injectionHistoryDocPath(
              injectionHistoryDocId(phone, firedAt),
            ),
            data: terminal as unknown as Record<string, unknown>,
          },
          { type: "delete", path: scheduledInjectionDocPath(phone) },
        ]);
        // Terminal write landed → text Adam now. Push ONLY after the batch
        // succeeds: on a failed terminal write the doc survives and re-terminals
        // next sweep, so paging here (not in the catch) avoids re-texting every
        // minute while a write is stuck. The push never THROWS, but it is awaited
        // (blocks ≤5s on a hung receiver, serialized across terminals in a sweep)
        // so the alert delivers before the cron tears down — fine, terminals are
        // rare.
        await pushInjectionFailure({
          phone,
          error: errorMsg ?? "unknown",
          attempts,
        });
      } catch (e2) {
        // Batch failed → the delete didn't happen, so the doc survives and the
        // next sweep re-evaluates it. The dial error was already pushed to
        // `errors` above, so DON'T double-count — and DON'T page (we page once
        // the terminal write finally lands).
        console.error(
          `[sweep] ❌ terminal batch write failed phone=${phone} → ${
            (e2 as Error).message
          }`,
        );
      }
      continue;
    }

    // ─── Success / skipped path: atomic history-write + delete ──────────────
    // Both ops go through ONE batch so they're all-or-nothing. As two separate
    // ops, a delete failure after the set re-fired the injection next sweep
    // (duplicate dial). The scheduledinjection is deleted even on a dedup
    // skip — leaving it would re-evaluate every minute forever; it has served
    // its purpose once an injectionhistory entry exists.
    const history: InjectionHistoryEntry = {
      phone,
      eventTime: injection.eventTime,
      scheduledAt: injection.scheduledAt,
      firedAt,
      firedBy,
      status,
      ...(injection.isTest ? { isTest: true } : {}),
      ...(skipReason ? { skipReason } : {}),
    };
    try {
      await client.batch([
        {
          type: "set",
          path: injectionHistoryDocPath(injectionHistoryDocId(phone, firedAt)),
          data: history as unknown as Record<string, unknown>,
        },
        { type: "delete", path: scheduledInjectionDocPath(phone) },
      ]);
    } catch (e) {
      // A transient batch failure must NOT abort the whole sweep and strand the
      // REMAINING due phones. The doc stays in place (the batch is
      // all-or-nothing, so no history was written either) and the next sweep
      // retries it — delay-not-loss.
      errors.push({ phone, error: (e as Error).message });
      console.error(
        `[sweep] ❌ batch write failed phone=${phone} → ${
          (e as Error).message
        }`,
      );
    }
  }

  // `scanned` = due docs the sweep considered (identical to dueDocs.length now
  // that the where-filter does the work the in-memory scan used to).
  return { scanned: dueDocs.length, fired, skipped, retrying, errors };
}

export async function fireSingle(
  phone: string,
  firedBy: "cron" | "manual" = "manual",
  client: FirestoreClient = getFirestoreClient(),
): Promise<{ fired: boolean; skipped?: boolean; error?: string }> {
  const inj = await client.get(scheduledInjectionDocPath(phone)) as
    | FutureInjection
    | null;
  if (!inj) return { fired: false, error: "not scheduled" };

  const firedAt = new Date().toISOString();
  let status: InjectionHistoryEntry["status"] = "success";
  let errorMsg: string | undefined;
  let skipReason: string | undefined;
  try {
    const r = await handleDelayedInjection(phone);
    if (r.skipped) {
      status = "skipped";
      skipReason = r.reason;
    }
  } catch (e) {
    status = "error";
    errorMsg = (e as Error).message;
  }

  // Error path: DELAY-NOT-LOSS. Don't consume the appointment on a failed
  // manual fire — keep the scheduledinjection (bump `attempts`) so the
  // every-minute cron sweep automatically retries it and eventually writes a
  // terminal status="error" once MAX_INJECTION_ATTEMPTS is reached. Pre-fix a
  // failed manual fire deleted the doc, permanently losing the booking.
  if (status === "error") {
    const attempts = (inj.attempts ?? 0) + 1;
    try {
      await client.setMerge(scheduledInjectionDocPath(phone), {
        attempts,
        lastError: errorMsg ?? "unknown",
        lastAttemptAt: firedAt,
      });
    } catch (e2) {
      console.error(
        `[fireSingle] ⚠️ retry bookkeeping write failed phone=${phone} → ${
          (e2 as Error).message
        }`,
      );
    }
    console.error(
      `[fireSingle] ❌ phone=${phone} attempt=${attempts} kept for retry → ${errorMsg}`,
    );
    return { fired: false, error: errorMsg };
  }

  // Success / skipped: record history + delete the scheduledinjection atomically
  // (see sweepScheduledInjections — a delete failing after the set re-fires the
  // injection).
  const history: InjectionHistoryEntry = {
    phone,
    eventTime: inj.eventTime,
    scheduledAt: inj.scheduledAt,
    firedAt,
    firedBy,
    status,
    ...(inj.isTest ? { isTest: true } : {}),
    ...(skipReason ? { skipReason } : {}),
  };
  await client.batch([
    {
      type: "set",
      path: injectionHistoryDocPath(injectionHistoryDocId(phone, firedAt)),
      data: history as unknown as Record<string, unknown>,
    },
    { type: "delete", path: scheduledInjectionDocPath(phone) },
  ]);
  return {
    fired: status === "success",
    ...(status === "skipped" ? { skipped: true } : {}),
  };
}
