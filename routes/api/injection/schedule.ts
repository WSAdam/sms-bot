import { define } from "@/utils.ts";
import { scheduleInjection } from "@shared/services/injections/schedule.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; eventTime?: string; isTest?: boolean; calendlyInviteeUri?: string }
      | null;
    if (!body?.phone || !body.eventTime) {
      return Response.json(
        { error: "Body must be {phone, eventTime, [isTest], [calendlyInviteeUri]}" },
        { status: 400 },
      );
    }
    try {
      await scheduleInjection(
        body.phone,
        body.eventTime,
        !!body.isTest,
        body.calendlyInviteeUri,
      );
      return Response.json({ success: true, phone: body.phone, eventTime: body.eventTime });
    } catch (e) {
      return Response.json({ error: (e as Error).message }, { status: 400 });
    }
  },
});
