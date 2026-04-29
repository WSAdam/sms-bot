// POST /cal/delete-scheduled-injection
//
// Cancel a guest's scheduled SMS injection (always) and, if a Cal.com
// bookingUid is provided, attempt to cancel the Cal.com booking too
// (best-effort). Logs a SCRUB orchestrator event with details indicating
// what was cancelled.
//
// Body: { phone, bookingUid? }

import { define } from "@/utils.ts";
import * as cal from "@shared/services/cal/service.ts";
import { cancelScheduledInjection } from "@shared/services/injections/schedule.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; bookingUid?: string }
      | null;

    if (!body?.phone) {
      return Response.json({ error: "Missing phone" }, { status: 400 });
    }
    const phone10 = normalizePhone(body.phone);
    if (!phone10) {
      return Response.json({ error: "Invalid phone" }, { status: 400 });
    }

    await cancelScheduledInjection(phone10);

    let calCancelled = false;
    if (body.bookingUid) {
      try {
        await cal.cancelBooking(body.bookingUid, "Cancelled via API");
        calCancelled = true;
      } catch (e) {
        console.error(
          `[cal/delete] ❌ cal.cancelBooking failed: ${(e as Error).message}`,
        );
      }
    }

    const detailsSuffix = body.bookingUid
      ? " and Cal.com Booking"
      : "";
    await orchestrator.logEvent(phone10, {
      action: "SCRUB",
      domain: DialerDomain.ODR,
      details: "Cancelled Scheduled Injection" + detailsSuffix,
    });

    return Response.json({
      success: true,
      calCancelled,
      message: body.bookingUid
        ? (calCancelled
          ? "Scheduled Injection and Cal.com Booking Cancelled"
          : "Scheduled Injection Cancelled (Cal.com cancel failed)")
        : "Scheduled Injection Cancelled",
    });
  },
});
