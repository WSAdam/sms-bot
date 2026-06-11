// Per-phone rate limiter (default 30 days). Reads/writes under
// sms-bot/ratelimit/byPhone/{phone10}. Fail-open if Firestore is unreachable.
//
// Window length is read from gatesConfig (live-editable from the
// dashboard) on every check. The gates-config layer caches for 60s
// internally so this isn't a per-check round trip.

import { rateLimitDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import { normalizePhone } from "@shared/util/phone.ts";

interface RateLimitRecord {
  limited: boolean;
  at: number;
}

let queue: Promise<unknown> = Promise.resolve();

async function windowMs(client: FirestoreClient): Promise<number> {
  const gates = await getGatesConfig(client);
  return gates.rateLimitWindowDays * 24 * 60 * 60 * 1000;
}

export async function checkOnly(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return true;
  try {
    const [record, ms] = await Promise.all([
      client.get(rateLimitDocPath(phone10)) as Promise<
        RateLimitRecord | null
      >,
      windowMs(client),
    ]);
    if (record?.at && Date.now() - record.at < ms) return false;
    return true;
  } catch (e) {
    console.error("[rate-limiter] check failed, fail-open:", e);
    return true;
  }
}

export async function reserve(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return;
  try {
    await client.set(rateLimitDocPath(phone10), {
      limited: true,
      at: Date.now(),
    });
  } catch (e) {
    console.error("[rate-limiter] reserve failed:", e);
  }
}

// Serialize outbound calls (used by readymode service to avoid hammering RM).
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(() => fn());
  queue = result.catch(() => {});
  return result;
}
