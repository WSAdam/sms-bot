// Main entry point for ReadyMode dialer webhooks.

import { define } from "@/utils.ts";
import { processInboundLead } from "@shared/services/readymode/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const body = await ctx.req.json().catch(() => ({}));
    const queryObj: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) queryObj[k] = v;

    const merged = { ...queryObj, ...(body as Record<string, unknown>) };
    const r = await processInboundLead(merged);
    return Response.json(r);
  },
});
