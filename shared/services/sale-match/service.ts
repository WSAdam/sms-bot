// Sale-match: given a list of phones from the Quickbase bookings report,
// match each against the latest scheduled-injection record. If the booking is
// within `windowDays` of when the injection was scheduled, mark a sale and
// activate the guest.

import { SALE_MATCH_WINDOW_DAYS } from "@shared/config/constants.ts";
import {
  guestActivatedDocPath,
  salesWithin7dDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import {
  type FirestoreClient,
  getFirestoreClient,
} from "@shared/firestore/wrapper.ts";
import type {
  ActivateFromReportSummary,
  SaleWithinWindowMarker,
} from "@shared/types/sale.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { isWithinWindowAfter, parseDateishToMs } from "@shared/util/time.ts";

export interface SaleMatchInput {
  phone10: string;
  saleAt?: string; // when the sale was recorded (defaults to now)
}

export async function processSaleMatches(
  inputs: SaleMatchInput[],
  client: FirestoreClient = getFirestoreClient(),
): Promise<ActivateFromReportSummary> {
  const summary: ActivateFromReportSummary = {
    success: true,
    fetchedFromReport: inputs.length,
    matched: 0,
    skippedNoInjection: 0,
    skippedOlderThan7Days: 0,
    matches: [],
  };

  for (const { phone10, saleAt } of inputs) {
    if (phone10.length !== 10) {
      summary.skippedNoInjection++;
      continue;
    }

    const inj = await client.get(scheduledInjectionDocPath(phone10)) as
      | FutureInjection
      | null;
    if (!inj) {
      summary.skippedNoInjection++;
      continue;
    }

    const apptMs = parseDateishToMs(inj.eventTime);
    const saleMs = saleAt ? parseDateishToMs(saleAt) : Date.now();
    if (apptMs == null || saleMs == null) {
      summary.skippedNoInjection++;
      continue;
    }

    if (!isWithinWindowAfter(apptMs, saleMs, SALE_MATCH_WINDOW_DAYS)) {
      summary.skippedOlderThan7Days++;
      continue;
    }

    const withinDays = (saleMs - apptMs) / (24 * 60 * 60 * 1000);
    const updatedAt = new Date().toISOString();

    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt: inj.eventTime,
      saleAt: new Date(saleMs).toISOString(),
      windowDays: SALE_MATCH_WINDOW_DAYS,
      withinDays,
      updatedAt,
    };
    await client.set(
      salesWithin7dDocPath(phone10),
      marker as unknown as Record<string, unknown>,
    );
    await client.set(guestActivatedDocPath(phone10), {
      phone10,
      Activated: true,
      activatedAt: updatedAt,
      eventTime: inj.eventTime,
    });

    summary.matched++;
    summary.matches.push({
      phone10,
      appointmentAt: inj.eventTime,
      withinDays,
    });
  }

  return summary;
}
