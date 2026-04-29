// Placeholder implementations for Quickbase ops other than getReport. Replace
// these with a real client when the upstream is ready.
//
// `isDNC` soft-fails to false (does NOT throw) so the trigger gatekeeper can
// keep running while the stub is in place. Set QUICKBASE_FAIL_OPEN=false in
// env to flip this to a fail-closed check before production cutover.

import { loadEnv } from "@shared/config/env.ts";
import {
  NotImplementedError,
  type ReservationLookup,
} from "@shared/services/quickbase/client.ts";

export function stubFindReservation(
  _resId: number,
): Promise<ReservationLookup | null> {
  throw new NotImplementedError("findReservationByResID");
}

export function stubMarkDNC(_phone: string): Promise<{ success: boolean }> {
  throw new NotImplementedError("markDNC");
}

export function stubIsDNC(phone: string): Promise<boolean> {
  const env = loadEnv();
  if (env.quickbaseFailOpen) {
    console.warn(
      `⚠️  Quickbase isDNC stub returning false for ${phone} (fail-open mode).`,
    );
    return Promise.resolve(false);
  }
  throw new NotImplementedError("isDNC");
}
