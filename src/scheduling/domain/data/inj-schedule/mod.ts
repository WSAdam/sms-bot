// Scheduled injection storage (set + cancel + lookup).

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import {
  injectedPhoneDocPath,
  metricsDailyDocPath,
  metricsLifetimeDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { normalizePhone } from "@shared/util/phone.ts";
import { easternDateString } from "@shared/util/time.ts";

export async function scheduleInjection(
  rawPhone: string,
  eventTime: string | Date,
  isTest = false,
  calendlyInviteeUri?: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone = normalizePhone(rawPhone);
  if (!phone) throw new Error("invalid phone");
  // Hard guard — test phones (Adam's, Edwin's, etc.) must NEVER end up in
  // scheduledinjections. Otherwise the every-minute cron sweep dials the
  // operator. Centralized here so every call site (cal/schedule, Cal.com
  // appointment-booked, booking-scan, repopulate-injections) inherits the
  // protection automatically.
  if (isExcludedFromReporting(phone)) {
    console.warn(
      `[scheduleInjection] ⏭ refused excluded test phone ${phone}`,
    );
    return;
  }
  const isoTime = typeof eventTime === "string"
    ? eventTime
    : eventTime.toISOString();
  // Boundary guard: refuse TZ-naive eventTimes. JS interprets strings
  // without a Z or ±HH:MM as UTC, so a naive `"2026-06-14T07:30:00"`
  // would fire at 3:30am EDT (4h early) for an "intended" 7:30am
  // local appointment. Every write path is required to normalize via
  // normalizeAppointmentTime() before getting here. Throwing here
  // means any future code-path that forgets will fail loud at deploy
  // time instead of producing a customer-facing bug months later.
  // See [shared/util/time.ts](shared/util/time.ts).
  if (!/Z$|[+-]\d{2}:?\d{2}$/.test(isoTime)) {
    throw new Error(
      `scheduleInjection: eventTime must be canonical UTC (Z) or ` +
        `offset-tagged (±HH:MM). Got TZ-naive: ${isoTime}. ` +
        `Pipe through normalizeAppointmentTime() at the write site.`,
    );
  }
  const nowIso = new Date().toISOString();
  const data: FutureInjection = {
    phone,
    eventTime: isoTime,
    scheduledAt: Date.now(),
    isTest,
    ...(calendlyInviteeUri ? { calendlyInviteeUri } : {}),
  };
  await client.set(
    scheduledInjectionDocPath(phone),
    data as unknown as Record<string, unknown>,
  );
  // Write-side aggregators (fire-and-forget; never block the schedule
  // operation on these). See firestore-safety.md.
  recordInjectionAggregators(client, phone, isTest, nowIso).catch((e) => {
    console.warn(
      `[scheduleInjection] aggregator write failed (non-fatal): ${
        (e as Error).message
      }`,
    );
  });
}

async function recordInjectionAggregators(
  client: FirestoreClient,
  phone: string,
  isTest: boolean,
  nowIso: string,
): Promise<void> {
  // Always stamp the injectedphones marker so /api/guests/answered can
  // do a single-doc lookup. atomicCreate covers first-time inserts;
  // setMerge covers updates to lastInjectedAt on repeat schedules.
  const r = await client.atomicCreate(injectedPhoneDocPath(phone), {
    phone,
    firstInjectedAt: nowIso,
    lastInjectedAt: nowIso,
  });
  if (!r.created) {
    await client.setMerge(injectedPhoneDocPath(phone), {
      lastInjectedAt: nowIso,
    });
  }
  // Test bookings shouldn't roll up into the report counters. Real
  // bookings increment both daily and lifetime `apptsBooked`.
  if (isTest) return;
  const today = easternDateString();
  try {
    await Promise.all([
      client.incrementField(metricsDailyDocPath(today), { apptsBooked: 1 }),
      client.setMerge(metricsDailyDocPath(today), { updatedAt: nowIso }),
      client.incrementField(metricsLifetimeDocPath(), { apptsBooked: 1 }),
      client.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIso }),
    ]);
    // Clear any stale failure flag a PRIOR failed write stamped, now that the
    // counter incremented cleanly for this day. Setting null (non-string)
    // clears the "possibly incomplete" marker without a delete sentinel.
    // Best-effort — independent of the increment above.
    await client.setMerge(metricsDailyDocPath(today), {
      apptsBookedCounterFailedAt: null,
    }).catch((e) =>
      console.warn(
        `[inj-schedule] apptsBooked failure-flag clear failed for ${today}: ${
          (e as Error).message
        } (stale ydBookingsReliable=false may persist)`,
      )
    );
  } catch (e) {
    // Make the silent counter drift OBSERVABLE — mirror sale-match's
    // *CounterFailedAt pattern. If the apptsBooked increment fails
    // (quota/network), stamp a per-day flag so the dashboard / nightly report
    // can mark that day's bookings counter as possibly incomplete instead of
    // emailing a number that was never incremented. The flag write is
    // independent of the increment that just failed.
    const failNow = new Date().toISOString();
    await client.setMerge(metricsDailyDocPath(today), {
      apptsBookedCounterFailedAt: failNow,
    }).catch((e2) =>
      console.warn(
        `[inj-schedule] apptsBooked failure-flag stamp failed for ${today}: ${
          (e2 as Error).message
        } (counter drift will look reliable)`,
      )
    );
    // Re-throw so the fire-and-forget caller logs the aggregator failure as
    // before — the flag is additive observability, not a swallow.
    throw e;
  }
}

export async function getScheduledInjection(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<FutureInjection | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  return await client.get(scheduledInjectionDocPath(phone)) as
    | FutureInjection
    | null;
}

export async function cancelScheduledInjection(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;
  await client.delete(scheduledInjectionDocPath(phone));
  return true;
}
