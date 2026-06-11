// Delayed-injection handler. Called when the cron sweep finds a scheduled
// injection whose time has come, OR when the queue/trigger endpoint is hit
// directly with `{type: "INJECT_APPT", phone}`.
//
// Workflow:
//   0. Dedup guard: if injectionhistory has an entry within the
//      gates-config window (default 72h), skip the dial entirely.
//      Added after the 2026-05-25 near-miss where the sweep would have
//      re-dialed phones that had been talk-now'd 3-7 days earlier.
//   1. Read the lead pointer.
//   2. If there's an originalSource, scrub from it (best-effort).
//   3. Inject into the "ODR - Appointments" campaign.
//   4. Update pointer + log event.

import { injectionHistoryCollection } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { getGatesConfig } from "@shared/services/config/gates-config.ts";
import { CAMPAIGN_MASTER_MAP } from "@shared/services/readymode/campaigns.ts";
import { injectLead, scrubLead } from "@shared/services/readymode/service.ts";
import * as orchestrator from "@shared/services/orchestrator/service.ts";
import type { ReadymodeLeadDto } from "@shared/types/readymode.ts";

export type HandleDelayedInjectionResult =
  | { skipped: false }
  | { skipped: true; reason: string };

export async function handleDelayedInjection(
  phone: string,
): Promise<HandleDelayedInjectionResult> {
  // Dedup guard. Read injectionhistory for this phone (single-field
  // index on `phone`, limit 5 — small slice is enough since we're
  // checking "most recent within N hours"). Pulled from gatesConfig
  // so the window is live-editable.
  const gates = await getGatesConfig();
  const windowHours = gates.scheduledInjectionDedupHours;
  if (windowHours > 0) {
    const cutoffMs = Date.now() - windowHours * 3_600_000;
    const recent = await getFirestoreClient().list(injectionHistoryCollection, {
      where: { field: "phone", op: "==", value: phone },
      limit: 5,
    });
    let lastFiredMs = 0;
    for (const r of recent) {
      const firedAt = (r.data as Record<string, unknown>).firedAt;
      if (typeof firedAt === "string") {
        const ms = new Date(firedAt).getTime();
        if (Number.isFinite(ms) && ms > lastFiredMs) lastFiredMs = ms;
      }
    }
    if (lastFiredMs > cutoffMs) {
      const minutesAgo = Math.round((Date.now() - lastFiredMs) / 60_000);
      const reason = `fired ${minutesAgo}m ago`;
      console.log(`⏭  skip dial ${phone} — ${reason}`);
      return { skipped: true, reason };
    }
  }

  const pointer = await orchestrator.getPointer(phone);

  if (pointer?.originalSource) {
    try {
      await scrubLead(phone, pointer.originalSource.domain);
    } catch (e) {
      console.warn(
        `[queue] scrub original source failed (non-fatal): ${
          (e as Error).message
        }`,
      );
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
    return { skipped: false };
  } else {
    throw new Error(`ODR injection failed: ${result.message}`);
  }
}
