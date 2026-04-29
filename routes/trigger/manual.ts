// Manual SMS trigger for testing. Forces override=true so all gatekeepers
// are bypassed (attempts, daily cap, DNC, rate limit).

import { define } from "@/utils.ts";
import { processInboundLead } from "@shared/services/readymode/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => ({}));
    const r = await processInboundLead({
      ...(body as Record<string, unknown>),
      override: true,
    });
    return Response.json(r);
  },
});
