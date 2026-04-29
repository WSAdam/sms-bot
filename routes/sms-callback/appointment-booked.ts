// Cal.com (or Bland) posts here when a guest books. Resolve the lead's
// current pointer, scrub from that domain (best-effort), then write a
// scheduled-injection so the cron sweep can fire it later.

import { define } from "@/utils.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import { scrubLead } from "@shared/services/readymode/service.ts";
import { saveContext, getContext } from "@shared/services/sms-flow-context/service.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; event_time?: string; calendly_invitee_uri?: string }
      | null;
    if (!body?.phone || !body?.event_time) {
      return Response.json(
        { error: "Body must include {phone, event_time}" },
        { status: 400 },
      );
    }
    const phone = normalizePhone(body.phone);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

    const pointer = await orchestrator.getPointer(phone);
    const sourceDomain = (pointer?.currentLocation?.domain ?? DialerDomain.ODS) as DialerDomain;
    try {
      await scrubLead(phone, sourceDomain);
    } catch (e) {
      console.warn(`[appt] scrub failed (non-fatal): ${(e as Error).message}`);
    }

    const dateStr = new Date(body.event_time).toLocaleString("en-US", {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
      timeZone: "America/New_York",
    });
    const infoString = `Scheduled: ${dateStr}`;
    const existing = (await getContext(phone)) ?? {};
    await saveContext(phone, {
      ...existing,
      sourceUrl: infoString,
      notes: `SMS Appointment Booked - ${infoString}`,
    });

    await scheduleInjection(
      phone,
      body.event_time,
      false,
      body.calendly_invitee_uri,
    );

    return Response.json({ status: "success", message: "Appointment Processed" });
  },
});
