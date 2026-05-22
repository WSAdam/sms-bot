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
  await Promise.all([
    client.incrementField(metricsDailyDocPath(today), { apptsBooked: 1 }),
    client.setMerge(metricsDailyDocPath(today), { updatedAt: nowIso }),
    client.incrementField(metricsLifetimeDocPath(), { apptsBooked: 1 }),
    client.setMerge(metricsLifetimeDocPath(), { updatedAt: nowIso }),
  ]);
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
