import { define } from "@/utils.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const { phone } = ctx.params as { phone: string };
    const events = await orchestrator.getEvents(phone);
    return Response.json(events);
  },
});
