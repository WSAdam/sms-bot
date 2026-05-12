// Hot-path immediate injection. Optional source-domain scrub (best-effort,
// no lock — gotcha §15), then inject into the ODR Appointments campaign.
// After a successful inject, write an injectionhistory doc with
// firedBy:"talk-now" so sale-match can credit later activations and the
// dashboard can render the actual call moment as the scheduled time.
// Without that audit trail, talk-now sales used to surface only via the
// answered-backfill script reconstructing them after the fact.

import { define } from "@/utils.ts";
import { injectionHistoryDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
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
import { injectionHistoryDocId } from "@shared/util/id.ts";
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

    // Audit trail: record the talk-now injection so sale-match has a
    // first-class record to credit against, and so the dashboard can
    // show the actual inject moment under "Scheduled Call Time" (the
    // appointment IS now — eventTime=firedAt is intentional, not a
    // placeholder). Best-effort: failures here don't block the call,
    // they just mean we fall back to the answered-backfill path later.
    const firedAt = new Date().toISOString();
    try {
      await getFirestoreClient().set(
        injectionHistoryDocPath(injectionHistoryDocId(phone, firedAt)),
        {
          phone,
          eventTime: firedAt,
          scheduledAt: new Date(firedAt).getTime(),
          firedAt,
          firedBy: "talk-now",
          status: "success",
          // Explicitly NOT eventTimePlaceholder. The appointment really
          // is "now" — the guest just consented to be called immediately.
          campaignId: target.id,
          campaignName: target.name,
        },
      );
    } catch (e) {
      console.warn(`[talk-now] ih write failed (non-fatal): ${(e as Error).message}`);
    }

    return Response.json({
      status: "success",
      message: `Injected to ${target.name}`,
      result,
    });
  },
});
