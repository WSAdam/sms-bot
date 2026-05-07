// POST /cal/schedule
//
// Schedule an appointment for a guest. Mirrors the legacy CalController.
// Best-effort Cal.com booking, then unconditionally schedules the SMS
// injection, stores the "appointment scheduled" message, logs orchestrator
// events, and updates the lead pointer to SCHEDULED_FOR_ODR.
//
// Accepts BOTH naming conventions:
//   - Legacy:    { phone, email, name, startTime, timeZone? }
//   - Bland/Cal: { inviteePhone, inviteeEmail, inviteeName, startTime, timezone? }
//
// Bland's pathway switched to inviteeXxx + lowercase `timezone` around
// 2026-05-01, which silently 400'd every booking until this normalization
// was added. That gap is the root cause of the appointment-pipeline outage
// (no scheduledinjections written → no injectionhistory → empty dashboard).

import { define } from "@/utils.ts";
import { CAL_HOLDING_CAMPAIGN_ID } from "@shared/config/constants.ts";
import * as cal from "@shared/services/cal/service.ts";
import { storeMessage } from "@shared/services/conversations/store.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const raw = await ctx.req.json().catch(() => null) as
      | Record<string, unknown>
      | null;

    const body = raw
      ? {
        phone: (raw.phone ?? raw.inviteePhone) as string | undefined,
        email: (raw.email ?? raw.inviteeEmail) as string | undefined,
        name: (raw.name ?? raw.inviteeName) as string | undefined,
        startTime: raw.startTime as string | undefined,
        timeZone: (raw.timeZone ?? raw.timezone) as string | undefined,
        conversationId: raw.conversationId as string | undefined,
      }
      : null;

    if (!body?.phone || !body?.email || !body?.name || !body?.startTime) {
      return Response.json(
        {
          error:
            "Body must include {phone|inviteePhone, email|inviteeEmail, name|inviteeName, startTime}",
        },
        { status: 400 },
      );
    }

    const phone10 = normalizePhone(body.phone);
    if (!phone10) {
      return Response.json({ error: "Invalid phone" }, { status: 400 });
    }

    let bookingUid = "CAL_FAILED_BUT_INJECTION_SCHEDULED";
    let bookingSuccess = false;
    try {
      const r = await cal.createBooking({
        email: body.email,
        name: body.name,
        startTime: body.startTime,
        timeZone: body.timeZone,
        metadata: { phone10 },
      });
      bookingUid = r.data?.uid ?? r.uid ?? "CAL_BOOKED";
      bookingSuccess = true;
    } catch (e) {
      console.warn(
        `[cal/schedule] ⚠️ Cal.com booking failed: ${(e as Error).message} ` +
          `— proceeding with SMS injection (fail-safe)`,
      );
    }

    await scheduleInjection(phone10, body.startTime);

    const callId = body.conversationId ?? `appt_${bookingUid}`;
    const dateStr = new Date(body.startTime).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });

    try {
      await storeMessage(
        phone10,
        callId,
        "AI Bot",
        `Appointment Scheduled: ${dateStr}`,
        "appointment scheduled",
      );
    } catch (e) {
      console.warn(
        `[cal/schedule] ⚠️ storeMessage failed (non-fatal): ${
          (e as Error).message
        }`,
      );
    }

    await orchestrator.logEvent(phone10, {
      action: "SCHEDULE_TIMER",
      domain: DialerDomain.ODR,
      details: `Scheduled for ${body.startTime}`,
    });

    await orchestrator.updatePointer(phone10, {
      status: "SCHEDULED_FOR_ODR",
      currentLocation: {
        domain: DialerDomain.ODR,
        campaignId: CAL_HOLDING_CAMPAIGN_ID,
        timestamp: Date.now(),
      },
    });

    return Response.json({
      success: true,
      bookingSuccess,
      bookingUid,
      scheduledTime: body.startTime,
      message: bookingSuccess
        ? "Cal.com Appointment and SMS Injection Scheduled Successfully"
        : "SMS Injection Scheduled (Cal.com booking failed but injection will proceed)",
    });
  },
});
