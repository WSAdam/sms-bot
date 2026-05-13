// Dev tool: hand-fire a raw RM TPI lead-get by lead ID. Bypasses the
// production throttle / circuit breaker. Operator pastes a lead ID
// from a prior search and inspects the full lead JSON.
//
// POST /api/test/tpi/get
// body: { leadId: 2391391, dialerDomain: "monsteract" }

import { define } from "@/utils.ts";
import { rawGet } from "@shared/services/readymode/tpi-client.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

function coerceDomain(input: unknown): DialerDomain | null {
  const v = String(input ?? "").toLowerCase().trim();
  const known = Object.values(DialerDomain) as string[];
  return known.includes(v) ? (v as DialerDomain) : null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { leadId?: number | string; dialerDomain?: string }
      | null;
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const leadId = Number(body.leadId);
    if (!Number.isInteger(leadId) || leadId <= 0) {
      return Response.json(
        { error: "leadId must be a positive integer" },
        { status: 400 },
      );
    }
    const domain = coerceDomain(body.dialerDomain);
    if (!domain) {
      return Response.json(
        {
          error: `dialerDomain must be one of ${
            Object.values(DialerDomain).join(", ")
          }`,
        },
        { status: 400 },
      );
    }
    try {
      const r = await rawGet(leadId, domain);
      if (!r.ok) {
        return Response.json({ ok: false, reason: r.reason }, { status: 200 });
      }
      return Response.json({ ok: true, raw: r.json });
    } catch (e) {
      return Response.json(
        { ok: false, reason: "thrown", message: (e as Error).message },
        { status: 500 },
      );
    }
  },
});
