// Per-phone 30-day rate limiter. Reads/writes under
// sms-bot/ratelimit/byPhone/{phone10}. Fail-open if Firestore is unreachable.

import { RATE_LIMIT_WINDOW_DAYS } from "@shared/config/constants.ts";
import { rateLimitDocPath } from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

interface RateLimitRecord {
  limited: boolean;
  at: number;
}

const WINDOW_MS = RATE_LIMIT_WINDOW_DAYS * 24 * 60 * 60 * 1000;

let queue: Promise<unknown> = Promise.resolve();

export async function checkOnly(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return true;
  try {
    const record = await client.get(rateLimitDocPath(phone10)) as
      | RateLimitRecord
      | null;
    if (record?.at && Date.now() - record.at < WINDOW_MS) return false;
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
    await client.set(rateLimitDocPath(phone10), { limited: true, at: Date.now() });
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
