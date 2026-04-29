import { define } from "@/utils.ts";
import { checkAuditMarker } from "@shared/services/audit/service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const recordId = url.searchParams.get("recordId");
    const stage = url.searchParams.get("stage");
    if (!recordId) {
      return Response.json({ error: "Missing recordId" }, { status: 400 });
    }
    const r = await checkAuditMarker({ recordId, stage });
    return Response.json(r);
  },
});
