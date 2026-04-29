// Delayed-injection handler. Called when the cron sweep finds a scheduled
// injection whose time has come, OR when the queue/trigger endpoint is hit
// directly with `{type: "INJECT_APPT", phone}`.
//
// Workflow:
//   1. Read the lead pointer.
//   2. If there's an originalSource, scrub from it (best-effort).
//   3. Inject into the "ODR - Appointments" campaign.
//   4. Update pointer + log event.

import { CAMPAIGN_MASTER_MAP } from "@shared/services/readymode/campaigns.ts";
import { injectLead, scrubLead } from "@shared/services/readymode/service.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import type { ReadymodeLeadDto } from "@shared/types/readymode.ts";

export async function handleDelayedInjection(phone: string): Promise<void> {
  const pointer = await orchestrator.getPointer(phone);

  if (pointer?.originalSource) {
    try {
      await scrubLead(phone, pointer.originalSource.domain);
    } catch (e) {
      console.warn(`[queue] scrub original source failed (non-fatal): ${(e as Error).message}`);
    }
  }

  const target = CAMPAIGN_MASTER_MAP["ODR - Appointments"];
  if (!target) {
    throw new Error("Missing 'ODR - Appointments' campaign config");
  }

  const result = await injectLead(
    {
      phone,
      notes: "Scheduled Appointment Time Reached - Auto Injection",
    } as ReadymodeLeadDto,
    target.domain,
    target.id,
  );

  if (result.status === "success") {
    await orchestrator.logEvent(phone, {
      action: "INJECT",
      domain: target.domain,
      details: "Queue Worker: Scheduled Appointment Injection",
    });
    await orchestrator.updatePointer(phone, {
      status: "IN_ODR",
      currentLocation: {
        domain: target.domain,
        campaignId: target.id,
        timestamp: Date.now(),
      },
    });
  } else {
    throw new Error(`ODR injection failed: ${result.message}`);
  }
}
