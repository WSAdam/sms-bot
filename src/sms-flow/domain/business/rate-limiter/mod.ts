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

// Atomic check-and-reserve: inside a single Firestore transaction, read the
// existing timestamp and, only if it's outside the window, stamp a fresh
// reservation. Returns true when THIS caller won the reservation (clear to
// send), false when the phone is already reserved within the window.
//
// This closes the check-then-reserve TOCTOU: two concurrent requests for the
// same phone can no longer both read a stale timestamp, both pass, and both
// send — the loser of the transaction sees the winner's fresh stamp and is
// told to stand down. Fail-open (returns true) only on a transaction error,
// matching checkOnly's behavior so Firestore being unreachable never blocks
// the SMS path.
export async function checkAndReserve(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<boolean> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return true;
  try {
    const ms = await windowMs(client);
    let won = false;
    await client.transactionalUpdate(rateLimitDocPath(phone10), (existing) => {
      const at = typeof existing?.at === "number" ? existing.at : 0;
      if (at && Date.now() - at < ms) {
        // Already reserved within the window — leave the record untouched and
        // signal the caller to skip.
        won = false;
        return existing ?? { limited: true, at };
      }
      won = true;
      return { limited: true, at: Date.now() };
    });
    return won;
  } catch (e) {
    console.error("[rate-limiter] checkAndReserve failed, fail-open:", e);
    return true;
  }
}

// Release a reservation made by checkAndReserve/reserve. Used to roll back the
// pre-send reservation when the downstream send (Bland) fails, so a transient
// failure doesn't lock the phone out of the funnel for the full window.
// Best-effort: a failed release just leaves the (harmless) reservation in place.
export async function release(
  rawPhone: string,
  client: FirestoreClient = getFirestoreClient(),
): Promise<void> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) return;
  try {
    await client.delete(rateLimitDocPath(phone10));
  } catch (e) {
    console.error("[rate-limiter] release failed (non-fatal):", e);
  }
}

// Serialize outbound calls (used by readymode service to avoid hammering RM).
export function schedule<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(() => fn());
  queue = result.catch(() => {});
  return result;
}
