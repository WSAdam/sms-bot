// Cron-run heartbeat marker. Every Deno.cron handler in main.ts wraps
// its body with `recordCronRun(name, fn)`. The marker doc lives at
// metrics/cronruns/{name} and gets updated with the run's outcome —
// `/api/admin/cron-health` reads them to surface silent failures
// (e.g. the May 2026 sale-match BOOT_FAILED that went unnoticed for
// 16 days).
//
// Failure mode: if Firestore is unreachable when we try to stamp the
// marker, we log + swallow. The marker is observability, never a
// reason to fail a cron run.

import { metricsCronRunDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";

export interface CronRunMarker {
  lastRunAt: string;
  // "skipped" = the handler ran but intentionally did no work (a paused gate,
  // an already-sent report, a concurrent-loss claim, no data). Without this the
  // cron-health dashboard showed GREEN/ok for a sweep doing nothing, so a
  // safe-default disarm after a Firestore blip (incident 2026-06-29) looked
  // identical to healthy operation.
  lastStatus: "ok" | "error" | "skipped";
  lastDurationMs: number;
  lastError?: string;
  // Why the run skipped (only set when lastStatus === "skipped"). Surfaced on
  // /api/admin/cron-health so the operator sees "PAUSED: sweep disabled" rather
  // than a misleading OK.
  skipReason?: string;
}

// Handed to the wrapped fn so it can signal "I ran but did no real work" along
// with a human reason. recordCronRun records lastStatus:"skipped" + skipReason
// instead of "ok" when the fn called this before returning normally.
export interface CronRunContext {
  markSkipped: (reason: string) => void;
}

export async function recordCronRun<T>(
  name: string,
  fn: (ctx: CronRunContext) => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  let result: T;
  let caught: unknown;
  let skipReason: string | undefined;
  const ctx: CronRunContext = {
    markSkipped: (reason: string) => {
      // Last writer wins; first meaningful reason is usually the only one.
      skipReason = reason;
    },
  };
  try {
    result = await fn(ctx);
  } catch (e) {
    caught = e;
  }
  const elapsed = Math.round(performance.now() - t0);
  const status: CronRunMarker["lastStatus"] = caught
    ? "error"
    : skipReason !== undefined
    ? "skipped"
    : "ok";
  const marker: CronRunMarker = {
    lastRunAt: new Date().toISOString(),
    lastStatus: status,
    lastDurationMs: elapsed,
    ...(caught
      ? { lastError: String((caught as Error).message ?? caught).slice(0, 500) }
      : {}),
    ...(status === "skipped" && skipReason !== undefined
      ? { skipReason: skipReason.slice(0, 200) }
      : {}),
  };
  try {
    await getFirestoreClient().set(
      metricsCronRunDocPath(name),
      marker as unknown as Record<string, unknown>,
    );
  } catch (e) {
    console.warn(
      `[cron-health] ⚠️ marker write failed for ${name}: ${
        (e as Error).message
      }`,
    );
  }
  if (caught) throw caught;
  // deno-lint-ignore no-non-null-assertion
  return result!;
}
