// Root route. Handles three legacy modes:
//   GET  /              → render the landing page HTML
//   GET  /?recordId=X   → return audit-check JSON (legacy Quickbase webhook)
//   POST /              → audit-save JSON (legacy Quickbase webhook)

import { define } from "@/utils.ts";
import {
  checkAuditMarker,
  saveAuditMarker,
} from "@shared/services/audit/service.ts";
import { homePageHtml } from "@shared/ui/pages.ts";

const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const recordId = url.searchParams.get("recordId");
    if (recordId) {
      const stage = url.searchParams.get("stage");
      const r = await checkAuditMarker({ recordId, stage });
      return Response.json(r);
    }
    return new Response(homePageHtml, { headers: HTML_HEADERS });
  },
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
