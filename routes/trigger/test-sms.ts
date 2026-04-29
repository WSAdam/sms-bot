// Plain-text SMS send for QA. Bypasses the pathway entirely so you can
// preview a specific message body against a real phone. Body: { phone, message }.

import { define } from "@/utils.ts";
import { BLAND_AGENT_NUMBER } from "@shared/config/constants.ts";
import * as bland from "@shared/services/bland/client.ts";
import { toE164 } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; message?: string }
      | null;
    if (!body?.phone || !body?.message) {
      return Response.json(
        { error: "Body must include {phone, message}" },
        { status: 400 },
      );
    }
    const user_number = toE164(body.phone);
    if (!user_number) {
      return Response.json({ error: "Invalid phone" }, { status: 400 });
    }
    try {
      const r = await bland.sendSms({
        user_number,
        agent_number: BLAND_AGENT_NUMBER,
        agent_message: body.message,
      });
      return Response.json(
        { status: r.status, ok: r.ok, bland: r.json },
        { status: r.ok ? 200 : 502 },
      );
    } catch (e) {
      return Response.json(
        { error: (e as Error).message },
        { status: 502 },
      );
    }
  },
});
