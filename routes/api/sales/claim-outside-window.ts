// Manual override for an Activations Outside Window entry. Lifts a single
// phone from salesoutsidewindow → saleswithin7d + guestactivated, preserving
// the original closest-appt context on the marker so we still know it was a
// manual claim.
//
// POST body: { phone10: string, note?: string }

import { define } from "@/utils.ts";
import { SALE_MATCH_WINDOW_DAYS } from "@shared/config/constants.ts";
import {
  guestActivatedDocPath,
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

    const updatedAt = new Date().toISOString();
    const marker: SaleWithinWindowMarker = {
      phone10,
      phone11: `1${phone10}`,
      appointmentAt: closestAppointmentAt,
      saleAt: activatedAt,
      windowDays: SALE_MATCH_WINDOW_DAYS,
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
          activatedAt: updatedAt,
          eventTime: closestAppointmentAt,
          matchReason: "manual_override",
          ...(activator ? { activator } : {}),
          ...(office ? { office } : {}),
        },
      },
      { type: "delete", path: salesOutsideWindowDocPath(phone10) },
    ]);

    console.log(
      `[claim-outside-window] ✅ ${phone10} appt=${closestAppointmentAt ?? "?"} (${closestDaysDiff ?? "?"}d) office="${office ?? ""}" activator="${activator ?? ""}"`,
    );

    return Response.json({ success: true, phone10, marker });
  },
});
