// Post-call disposition. Three branches:
//   1. sale|booked → no-op (lead is done)
//   2. ODR-mapped (by webhook campaign or pointer) → scrub ODR, return to source
//   3. default → scrub source, recycle into mapped target if any

import { define } from "@/utils.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
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
  DialerDomain,
  type ReadymodeLeadDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const url = new URL(ctx.req.url);
    const body = await ctx.req.json().catch(() => ({})) as Record<string, unknown>;

    const phoneInput = body.phone ?? body.phoneNumber ??
      url.searchParams.get("phone") ?? url.searchParams.get("phoneNumber");
    const campaign = (body.campaign_name as string) ??
      url.searchParams.get("campaign") ?? "ODR_Auto_Return";
    const disposition = (body.disposition as string) ??
      url.searchParams.get("disposition") ?? "Manual Return";

    if (!phoneInput) {
      return Response.json({ error: "Missing phone number" }, { status: 400 });
    }
    const phone = normalizePhone(phoneInput);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

    const dispoLower = String(disposition).toLowerCase();
    if (dispoLower === "sale" || dispoLower === "booked") {
      return Response.json({ status: "success", message: "Sale recorded" });
    }

    const pointer = await orchestrator.getPointer(phone);
    const context = (await getContext(phone)) ?? {};
    const pointerSaysODR = pointer?.currentLocation?.domain === "monsterodr";
    const webhookSaysODR = String(campaign).toUpperCase().includes("ODR");

    if (webhookSaysODR || pointerSaysODR) {
      try {
        await scrubLead(phone, DialerDomain.ODR);
      } catch (e) {
        console.warn(`[dispo] ODR scrub failed: ${(e as Error).message}`);
      }
      if (!pointer?.originalSource) {
        return Response.json(
          { status: "error", message: "Lost Lead - No Source History" },
          { status: 200 },
        );
      }
      const source = pointer.originalSource;
      const resolvedConfig = getCampaignConfig(source.campaignId);
      const targetCampaignId = resolvedConfig?.id ?? source.campaignId;
      const standardLead = {
        phone,
        ...(context as Record<string, unknown>),
        notes: `Returned from ODR - Dispo: ${disposition}`,
      } as unknown as StandardLead;
      const dialerPayload = denormalize(source.domain as DialerDomain, standardLead);
      try {
        await injectLead(
          dialerPayload as ReadymodeLeadDto,
          source.domain as DialerDomain,
          targetCampaignId,
        );
      } catch (e) {
        return Response.json(
          { status: "error", message: `Inject failed: ${(e as Error).message}` },
          { status: 502 },
        );
      }
      await orchestrator.updatePointer(phone, {
        status: "RETURNED_TO_SOURCE",
        currentLocation: {
          domain: source.domain,
          campaignId: targetCampaignId,
          timestamp: Date.now(),
        },
      });
      return Response.json({ status: "success", message: "Returned to Source" });
    }

    // Standard recycle
    const sourceConfig = getCampaignConfig(campaign);
    if (!sourceConfig) {
      try {
        await scrubLead(phone, DialerDomain.MONSTER);
      } catch (e) {
        console.error(`[dispo] MONSTER scrub failed: ${(e as Error).message}`);
      }
      return Response.json({ status: "success", message: "Scrubbed (Unknown Campaign)" });
    }

    try {
      await scrubLead(phone, sourceConfig.domain, sourceConfig.id);
    } catch (e) {
      console.warn(`[dispo] source scrub failed (non-fatal): ${(e as Error).message}`);
    }

    if (sourceConfig.recycleTarget) {
      const targetConfig = CAMPAIGN_MASTER_MAP[sourceConfig.recycleTarget];
      if (targetConfig) {
        const standardLead = {
          phone,
          ...(context as Record<string, unknown>),
          notes: `Recycled from ${sourceConfig.name}`,
        } as unknown as StandardLead;
        const recyclePayload = denormalize(targetConfig.domain, standardLead);
        const result = await injectLead(
          recyclePayload as ReadymodeLeadDto,
          targetConfig.domain,
          targetConfig.id,
        );
        return Response.json({
          status: result.status,
          message: `Recycled to ${targetConfig.name}`,
        });
      }
    }

    return Response.json({ status: "success", message: "Scrubbed (No recycle target)" });
  },
});
