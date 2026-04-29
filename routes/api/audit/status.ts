// Multi-stage status: pass an optional comma-separated list of stages.
// Returns whether each stage's record exists for the given recordId, plus
// the legacy global record presence.

import { define } from "@/utils.ts";
import { checkAuditMarker } from "@shared/services/audit/service.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const recordId = url.searchParams.get("recordId");
    if (!recordId) {
      return Response.json({ error: "Missing recordId" }, { status: 400 });
    }
    const stagesParam = url.searchParams.get("stages") ?? "";
    const stages = stagesParam.split(",").map((s) => s.trim()).filter(Boolean);

    const stageStatuses: Record<string, unknown> = {};
    for (const s of stages) {
      stageStatuses[s] = await checkAuditMarker({ recordId, stage: s });
    }
    const legacy = await checkAuditMarker({ recordId, stage: null });

    return Response.json({ recordId, legacy, stages: stageStatuses });
  },
});
