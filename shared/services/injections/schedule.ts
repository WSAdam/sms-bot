// Scheduled injection storage (set + cancel + lookup).

import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { scheduledInjectionDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { normalizePhone } from "@shared/util/phone.ts";

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
  const isoTime = typeof eventTime === "string" ? eventTime : eventTime.toISOString();
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
}

export async function getScheduledInjection(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<FutureInjection | null> {
  const phone = normalizePhone(rawPhone);
  if (!phone) return null;
  return await client.get(scheduledInjectionDocPath(phone)) as FutureInjection | null;
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
