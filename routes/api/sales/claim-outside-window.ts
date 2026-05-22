// Manual override for an Activations Outside Window entry. Lifts a single
// phone from salesoutsidewindow → saleswithin7d + guestactivated, preserving
// the original closest-appt context on the marker so we still know it was a
// manual claim.
//
// POST body: { phone10: string, note?: string }

import { define } from "@/utils.ts";
import { isExcludedFromReporting } from "@shared/config/constants.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import {
  guestActivatedDocPath,
  guestAnsweredDocPath,
  salesOutsideWindowDocPath,
  salesWithin7dDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type { SaleWithinWindowMarker } from "@shared/types/sale.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone10?: string; phone?: string; note?: string }
      | null;
    const raw = body?.phone10 ?? body?.phone ?? "";
    const phone10 = normalizePhone(raw);
    if (!phone10) {
      return Response.json({ error: "Missing or invalid phone" }, {
        status: 400,
      });
    }
    if (isExcludedFromReporting(phone10)) {
      return Response.json({
        error: `${phone10} is in EXCLUDED_REPORTING_PHONES — refusing claim`,
      }, { status: 400 });
    }

    const db = getFirestoreClient();
    const outside = await db.get(salesOutsideWindowDocPath(phone10));
    if (!outside) {
      return Response.json({
        error: `No salesoutsidewindow record for ${phone10}`,
      }, { status: 404 });
    }

    const closestAppointmentAt =
      typeof outside.closestAppointmentAt === "string"
        ? outside.closestAppointmentAt
        : null;
    const closestDaysDiff = typeof outside.closestDaysDiff === "number"
      ? outside.closestDaysDiff
      : null;
    const activatedAt = typeof outside.activatedAt === "string"
      ? outside.activatedAt
      : new Date().toISOString();
    const office = typeof outside.office === "string" ? outside.office : null;
    const activator = typeof outside.activator === "string"
      ? outside.activator
      : null;

    const { saleMatchWindowDays } = await getGatesConfig(db);
    const updatedAt = new Date().toISOString();
    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt: closestAppointmentAt,
      saleAt: activatedAt,
      windowDays: saleMatchWindowDays,
      withinDays: closestDaysDiff,
      matchReason: "manual_override",
      ...(activator ? { activator } : {}),
      ...(office ? { office } : {}),
      updatedAt,
      meta: {
        claimedAt: updatedAt,
        ...(body?.note ? { note: body.note } : {}),
      },
    };

    // Diagnostic: did this phone already exist in guestactivated? If yes,
    // the dashboard count won't go up after this claim — useful to surface
    // so we can stop debugging "missing" totals that aren't actually missing.
    // Single-doc lookup, no whole-collection scan.
    const preActivated = await db.get(guestActivatedDocPath(phone10));

    await db.batch([
      {
        type: "set",
        path: salesWithin7dDocPath(phone10),
        data: marker as unknown as Record<string, unknown>,
      },
      {
        type: "set",
        path: guestActivatedDocPath(phone10),
        data: {
          phone10,
          Activated: true,
          // Preserve the actual QB activation date, not the claim-click time.
          activatedAt,
          eventTime: closestAppointmentAt,
          // Mirror the marker's withinDays so the dashboard short-circuits
          // on the stored value instead of re-parsing TZ-naive timestamps.
          withinDays: closestDaysDiff,
          matchReason: "manual_override",
          recordedAt: updatedAt,
          ...(activator ? { activator } : {}),
          ...(office ? { office } : {}),
        },
      },
      // Auto-write guestanswered — every claimed sale implies the dialer
      // spoke with this customer. Keeps activated ⊆ answered invariant.
      {
        type: "set",
        path: guestAnsweredDocPath(phone10),
        data: { phone10, answered: true, answeredAt: activatedAt },
      },
      { type: "delete", path: salesOutsideWindowDocPath(phone10) },
    ]);

    // Verify the write actually persisted before responding so the UI can
    // show that the claim "worked". Pre-fix this did 3 × 50k-limit scans
    // to compute before/after dashboard counts — overkill for a single-
    // phone diagnostic. Replaced by single-doc presence checks: either
    // it's there or it isn't, which is what the UI actually cares about.
    const postActivated = await db.get(guestActivatedDocPath(phone10));

    const excluded = isExcludedFromReporting(phone10);
    const phoneAlreadyActivated = preActivated !== null;
    const phoneNowActivated = postActivated !== null;

    console.log(
      `[claim-outside-window] ✅ ${phone10} appt=${
        closestAppointmentAt ?? "?"
      } (${closestDaysDiff ?? "?"}d) office="${office ?? ""}" activator="${
        activator ?? ""
      }" — phoneAlreadyActivated=${phoneAlreadyActivated} phoneNowActivated=${phoneNowActivated} excludedFromReporting=${excluded}`,
    );

    return Response.json({
      success: true,
      phone10,
      marker,
      diagnostic: {
        excludedFromReporting: excluded,
        phoneAlreadyActivated,
        phoneNowActivated,
      },
    });
  },
});
