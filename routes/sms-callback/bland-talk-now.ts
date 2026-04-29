// Hot-path immediate injection. Optional source-domain scrub (best-effort,
// no lock — gotcha §15), then inject into the ODR Appointments campaign.

import { define } from "@/utils.ts";
import {
  CAMPAIGN_MASTER_MAP,
  getCampaignConfig,
} from "@shared/services/readymode/campaigns.ts";
import { denormalize } from "@shared/services/readymode/mapping.ts";
import {
  injectLead,
  scrubLead,
} from "@shared/services/readymode/service.ts";
import { getContext } from "@shared/services/sms-flow-context/service.ts";
import {
  type DialerDomain,
  type ReadymodeLeadDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; phoneNumber?: string }
      | null;
    const phoneInput = body?.phoneNumber ?? body?.phone;
    if (!phoneInput) return Response.json({ error: "Phone required" }, { status: 400 });
    const phone = normalizePhone(phoneInput);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

    const context = (await getContext(phone)) ?? {};
    if ((context as { domain?: string }).domain) {
      try {
        await scrubLead(phone, (context as { domain: string }).domain as DialerDomain);
      } catch (e) {
        console.warn(`[talk-now] scrub failed (optional): ${(e as Error).message}`);
      }
    }

    const target = getCampaignConfig("ODR - Appointments") ?? CAMPAIGN_MASTER_MAP["ODR - Appointments"];
    if (!target) {
      return Response.json(
        { error: "Target Campaign Config Missing" },
        { status: 500 },
      );
    }

    const standardLead = {
      phone,
      ...(context as Record<string, unknown>),
      notes: "Hot Lead: Talk Now from Bland SMS",
    } as unknown as StandardLead;
    const odrPayload = denormalize(target.domain, standardLead);

    const result = await injectLead(
      odrPayload as ReadymodeLeadDto,
      target.domain,
      target.id,
    );
    return Response.json({
      status: "success",
      message: `Injected to ${target.name}`,
      result,
    });
  },
});
