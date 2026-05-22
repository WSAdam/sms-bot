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
  lastStatus: "ok" | "error";
  lastDurationMs: number;
  lastError?: string;
}

export async function recordCronRun<T>(
  name: string,
  fn: () => Promise<T>,
): Promise<T> {
  const t0 = performance.now();
  let result: T;
  let caught: unknown;
  try {
    result = await fn();
  } catch (e) {
    caught = e;
  }
  const elapsed = Math.round(performance.now() - t0);
  const marker: CronRunMarker = {
    lastRunAt: new Date().toISOString(),
    lastStatus: caught ? "error" : "ok",
    lastDurationMs: elapsed,
    ...(caught
      ? { lastError: String((caught as Error).message ?? caught).slice(0, 500) }
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
