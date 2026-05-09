// Manual trigger for the ReadyMode call-log scrape. Used to backfill
// arbitrary date ranges or to force-refresh today's data.
//
// POST body (all optional):
//   { fromDate?: "MM/DD/YYYY", toDate?: "MM/DD/YYYY",
//     domains?: string[],     // subset of DialerDomain values
//     maxPagesPerDomain?: number   // testing
//   }
//
// Defaults: yesterday in ET, ODR domain only.
//
// Returns the per-domain ScrapeResult so the caller can verify rows
// fetched / dispositions written / answered upserts.

import { define } from "@/utils.ts";
import { scrapeReadymode } from "@shared/services/readymode/scrape-orchestrator.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

const VALID_DOMAINS = new Set(Object.values(DialerDomain));

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => ({})) as {
      fromDate?: string;
      toDate?: string;
      domains?: string[];
      maxPagesPerDomain?: number;
    };

    let domains: DialerDomain[] | undefined;
    if (Array.isArray(body.domains) && body.domains.length > 0) {
      const filtered = body.domains.filter((d): d is DialerDomain =>
        VALID_DOMAINS.has(d as DialerDomain)
      );
      if (filtered.length === 0) {
        return Response.json({
          error: `Invalid domains. Allowed: ${
            Array.from(VALID_DOMAINS).join(", ")
          }`,
        }, { status: 400 });
      }
      domains = filtered;
    }

    try {
      const result = await scrapeReadymode({
        fromDate: body.fromDate,
        toDate: body.toDate,
        domains,
        maxPagesPerDomain: body.maxPagesPerDomain,
      });
      return Response.json({ success: true, ...result });
    } catch (e) {
      const msg = (e as Error).message;
      console.error(`[pull-readymode] ❌ ${msg}`);
      return Response.json({ success: false, error: msg }, { status: 500 });
    }
  },
});
