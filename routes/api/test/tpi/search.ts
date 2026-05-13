// Dev tool: hand-fire a raw RM TPI search for a phone. Bypasses the
// production throttle / circuit breaker so the operator can inspect the
// real RM response shape — including during multi-phone discovery
// probing. Returns the raw JSON RM gave us (or an error envelope).
//
// POST /api/test/tpi/search
// body: { phone: "8432222986", dialerDomain: "monsteract" }

import { define } from "@/utils.ts";
import { rawSearch } from "@shared/services/readymode/tpi-client.ts";
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
    try {
      const r = await rawSearch(phone, domain);
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
