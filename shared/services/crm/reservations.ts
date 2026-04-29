// CRM (reservation) lookup wrapper. Delegates to the Quickbase client. Wraps
// the call in a try/catch so a Quickbase outage (auth failure, 5xx after
// retries, missing token) doesn't crash the inbound trigger — caller treats
// `null` as "guest not found in CRM" and the override path can fall through
// with a stub guest (see shared/services/readymode/service.ts).

import {
  getQuickbaseClient,
  type ReservationLookup,
} from "@shared/services/quickbase/client.ts";

export async function findGuestByResId(
  resId: number,
): Promise<ReservationLookup | null> {
  try {
    return await getQuickbaseClient().findReservationByResID(resId);
  } catch (e) {
    console.warn(
      `[crm] Quickbase lookup failed for ${resId}: ${(e as Error).message}`,
    );
    return null;
  }
}
