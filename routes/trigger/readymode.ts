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

    // Fast-path reject for empty payloads. ReadyMode was hammering this
    // endpoint with empty {} bodies (probably non-lead events or unfilled
    // URL templates) and our 200 + 4 log lines per request masked the issue.
    // One short log + 400 lets the dialer know to stop retrying and keeps
    // the deploy logs scannable.
    const hasPhone = !!(
      merged.phone || merged.primaryPhone || merged.Phone
    );
    if (!hasPhone) {
      console.warn(
        `[trigger] ❌ rejecting empty/no-phone request — keys=${
          Object.keys(merged).join(",") || "(none)"
        }`,
      );
      return Response.json(
        { status: "error", message: "Missing phone number" },
        { status: 400 },
      );
    }

    const r = await processInboundLead(merged);
    // Map service-level errors to 4xx so the caller can see the difference
    // between accepted+skipped (200) and outright rejected (4xx).
    const status = r.status === "error" ? 400 : 200;
    return Response.json(r, { status });
  },
});
