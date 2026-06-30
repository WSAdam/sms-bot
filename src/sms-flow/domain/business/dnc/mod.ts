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
  // Fire-and-forget on failure (like rate-limiter.release): if Firestore is
  // down, swallow rather than throw. In /sms-callback/stop this lets the
  // dncGlobal()→502 path still run (the route's caller used to throw here,
  // skipping dncGlobal entirely and returning a bare 500), and the STOP is
  // already persisted to conversations. The local flag may be missed on a blip,
  // but the wrapper retries transient reads/writes and a re-STOP re-marks.
  try {
    await client.set(dncDocPath(phone10), {
      phone10,
      doNotText: true,
      reason,
      markedAt: new Date().toISOString(),
    });
  } catch (e) {
    console.warn(
      `⚠️ [dnc] markDnc write failed for ${phone10} (non-fatal): ${
        (e as Error).message
      }`,
    );
  }
}

export async function isDnc(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return false;
  // Fail-OPEN on read failure (return false), matching rate-limiter.checkOnly:
  // Firestore being unreachable must not throw all the way out of the
  // processInboundLead gatekeeper and return a 500 to ReadyMode. The wrapper
  // already retries transient reads; this guards the residual failure so a blip
  // looks like "not opted out" rather than crashing the trigger.
  try {
    const r = await client.get(dncDocPath(phone10));
    return !!r?.doNotText;
  } catch (e) {
    console.warn(
      `⚠️ [dnc] isDnc read failed for ${phone10}, fail-open (not DNC): ${
        (e as Error).message
      }`,
    );
    return false;
  }
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
