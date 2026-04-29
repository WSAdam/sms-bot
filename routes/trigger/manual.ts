// Manual SMS trigger for testing. Defaults to override=true so callers that
// don't pass it (legacy curl scripts, etc.) get the historical behaviour, but
// the test UI can pass override=false to exercise the full gatekeeper path.

import { define } from "@/utils.ts";
import { processInboundLead } from "@shared/services/readymode/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => ({})) as Record<string, unknown>;
    const override = body.override === undefined ? true : !!body.override;
    const r = await processInboundLead({ ...body, override });
    return Response.json(r);
  },
});
