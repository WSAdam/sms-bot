// CRM (reservation) lookup. Currently delegates to the Quickbase stub —
// returns null on NotImplementedError so callers don't blow up while we wait
// for the real Quickbase magic-mirror client.

import {
  getQuickbaseClient,
  NotImplementedError,
  type ReservationLookup,
} from "@shared/services/quickbase/client.ts";

export async function findGuestByResId(
  resId: number,
): Promise<ReservationLookup | null> {
  try {
    return await getQuickbaseClient().findReservationByResID(resId);
  } catch (e) {
    if (e instanceof NotImplementedError) {
      console.warn(
        `[crm] Quickbase findReservationByResID stub — returning null for ${resId}.`,
      );
      return null;
    }
    throw e;
  }
}
