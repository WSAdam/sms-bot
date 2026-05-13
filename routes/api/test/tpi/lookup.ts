// Dev tool: exercise the full production lookup path (search → pick
// biggest lead → get → extract attempts) including the throttle stack
// and circuit breaker. Use this to verify the path the live trigger
// uses, and to deliberately trip the rate cap during testing.
//
// POST /api/test/tpi/lookup
// body: { phone: "8432222986", dialerDomain: "monsteract" }

import { define } from "@/utils.ts";
import { fetchAttemptsFromTpi } from "@shared/services/readymode/tpi-client.ts";
import { DialerDomain } from "@shared/types/readymode.ts";

function coerceDomain(input: unknown): DialerDomain | null {
  const v = String(input ?? "").toLowerCase().trim();
  const known = Object.values(DialerDomain) as string[];
  return known.includes(v) ? (v as DialerDomain) : null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; dialerDomain?: string }
      | null;
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const phone = String(body.phone ?? "").replace(/\D/g, "");
    if (!/^\d{10}$/.test(phone)) {
      return Response.json(
        { error: "phone must be 10 digits after stripping" },
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
    const r = await fetchAttemptsFromTpi(phone, domain);
    return Response.json(r);
  },
});
