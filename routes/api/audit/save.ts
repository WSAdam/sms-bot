import { define } from "@/utils.ts";
import { saveAuditMarker } from "@shared/services/audit/service.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | {
        recordId?: string;
        stage?: string | null;
        source?: string;
        claim?: boolean;
        override?: boolean;
        meta?: Record<string, unknown>;
      }
      | null;
    if (!body?.recordId) {
      return Response.json({ error: "Missing recordId" }, { status: 400 });
    }
    const r = await saveAuditMarker({
      recordId: body.recordId,
      stage: body.stage ?? null,
      source: body.source,
      claim: body.claim,
      override: body.override,
      meta: body.meta,
    });
    return Response.json(r);
  },
});
