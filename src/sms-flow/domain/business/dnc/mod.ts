// DNC / opt-out flag. Stored at sms-bot/dnc/byPhone/{phone10}.

import { dncDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export async function markDnc(
  rawPhone: string,
  reason = "STOP",
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return;
  await client.set(dncDocPath(phone10), {
    phone10,
    doNotText: true,
    reason,
    markedAt: new Date().toISOString(),
  });
}

export async function isDnc(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return false;
  const r = await client.get(dncDocPath(phone10));
  return !!r?.doNotText;
}

// True when a dncGlobal() result reports failure for EVERY ReadyMode domain
// (and at least one domain was attempted). The STOP + conversation webhooks use
// it to return 502 instead of a misleading 200 when the RM-side opt-out landed
// nowhere. Nullish/empty → false (nothing attempted is not an all-fail). Single
// source of truth for which RM statuses count as failure.
export function allDncFailed(
  dncResults: Record<string, string> | undefined | null,
): boolean {
  if (!dncResults) return false;
  const values = Object.values(dncResults);
  return values.length > 0 &&
    values.every((v) => v === "Failed" || v === "Error");
}
