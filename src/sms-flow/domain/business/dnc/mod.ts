// DNC / opt-out flag. Stored at sms-bot/dnc/byPhone/{phone10}.

import { dncDocPath, metricsDailyDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
  withTransientRetry,
} from "@shared/firestore/wrapper.ts";
import { easternDateString } from "@shared/util/time.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export async function markDnc(
  rawPhone: string,
  reason = "STOP",
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return false;
  // The DNC flag is what isDnc gates inbound triggers on, so a lost write = a
  // legally-significant opt-out that could be re-contacted. Retry the idempotent
  // set on transient errors, and RETURN whether it landed so the caller
  // (/sms-callback/stop, the conversation webhook) can force a retry (502)
  // rather than report a success that silently dropped the flag.
  try {
    await withTransientRetry(
      `markDnc ${phone10}`,
      () =>
        client.set(dncDocPath(phone10), {
          phone10,
          doNotText: true,
          reason,
          markedAt: new Date().toISOString(),
        }),
    );
    return true;
  } catch (e) {
    console.warn(
      `⚠️ [dnc] markDnc write failed for ${phone10} (non-fatal): ${
        (e as Error).message
      }`,
    );
    return false;
  }
}

export async function isDnc(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return false;
  // Fail-CLOSED on a read failure (treat as opted-out → return true). isDnc
  // gates whether we contact a lead, and contacting a DNC/TCPA opt-out is a
  // compliance violation, so when we can't confirm we must NOT contact. The
  // wrapper already retries transient reads, so this only fires on a sustained
  // outage — during which conservatively skipping a few texts is the safe,
  // recoverable degradation (the lead stays in the funnel for a later trigger).
  // Best-effort daily counter so a spike in read failures (conservative skips)
  // is visible/rate-comparable rather than silent.
  try {
    const r = await client.get(dncDocPath(phone10));
    return !!r?.doNotText;
  } catch (e) {
    console.warn(
      `⚠️ [dnc] isDnc read failed for ${phone10} — failing CLOSED (treat as DNC): ${
        (e as Error).message
      }`,
    );
    client.incrementField(metricsDailyDocPath(easternDateString()), {
      dncReadFailures: 1,
    }).catch(() => {});
    return true;
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
