// Return a lead from ODR back to its original source domain.
// Both GET and POST are supported (legacy debug habit).

import { define } from "@/utils.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import { getCampaignConfig } from "@shared/services/readymode/campaigns.ts";
import { denormalize } from "@shared/services/readymode/mapping.ts";
import { injectLead, scrubLead } from "@shared/services/readymode/service.ts";
import { getContext } from "@shared/services/sms-flow-context/service.ts";
import {
  DialerDomain,
  type ReadymodeLeadDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

async function handle(ctx: { req: Request }) {
  const url = new URL(ctx.req.url);
  let phoneInput: string | null = null;
  if (ctx.req.method === "POST") {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; phoneNumber?: string }
      | null;
    phoneInput = body?.phone ?? body?.phoneNumber ?? null;
  }
  phoneInput = phoneInput ?? url.searchParams.get("phone") ??
    url.searchParams.get("phoneNumber");
  if (!phoneInput) {
    return Response.json({ error: "Missing phone number" }, { status: 400 });
  }
  const phone = normalizePhone(phoneInput);
  if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

  const pointer = await orchestrator.getPointer(phone);
  if (!pointer?.originalSource) {
    return Response.json({ error: "No original source found for this lead" }, {
      status: 404,
    });
  }

  try {
    await scrubLead(phone, DialerDomain.ODR);
  } catch (e) {
    console.warn(
      `[return] ODR scrub failed (non-fatal): ${(e as Error).message}`,
    );
  }

  const context = (await getContext(phone)) ?? {};
  const source = pointer.originalSource;
  const resolvedConfig = getCampaignConfig(source.campaignId);
  const targetCampaignId = resolvedConfig?.id ?? source.campaignId;

  const standardLead = {
    phone,
    ...(context as Record<string, unknown>),
    notes: "Returned from ODR",
  } as unknown as StandardLead;
  const dialerPayload = denormalize(
    source.domain as DialerDomain,
    standardLead,
  );

  const injectResult = await injectLead(
    dialerPayload as ReadymodeLeadDto,
    source.domain as DialerDomain,
    targetCampaignId,
  );

  // injectLead returns {status:"error"} WITHOUT throwing on most RM failures
  // (e.g. HTTP 200 + Accepted:false). If we don't check it, we'd flip the
  // pointer to RETURNED_TO_SOURCE and report success while the lead was
  // actually lost. Only update the pointer on a confirmed inject.
  if (injectResult.status !== "success") {
    // Coarse status only — don't echo the raw RM inject payload (lead/phone
    // identifiers) back in the response body. Full detail is in the server logs.
    return Response.json(
      {
        status: "error",
        message: "Return to source failed — lead not injected",
        resultStatus: injectResult.status,
      },
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

  return Response.json({
    status: "success",
    message: "Returned to Source",
    source,
    injectResult,
  });
}

export const handler = define.handlers({
  GET: handle,
  POST: handle,
});
