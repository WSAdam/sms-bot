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
import * as orchestrator from "@sms-flow/domain/data/orchestrator-store/mod.ts";
import type { ReadymodeLeadDto } from "@shared/types/readymode.ts";

export type HandleDelayedInjectionResult =
  | { skipped: false }
  | { skipped: true; reason: string };

export async function handleDelayedInjection(
  phone: string,
): Promise<HandleDelayedInjectionResult> {
  // Dedup guard. Skip the dial only if we ALREADY successfully dialed this
  // phone within scheduledInjectionDedupHours (live-editable via gatesConfig).
  //
  // FAIL-OPEN BY DESIGN: this is a SECONDARY safety check (avoid a rare
  // double-dial). It must NEVER abort the PRIMARY injection. A throw here —
  // e.g. the missing (phone, firedAt) composite index that silently consumed
  // every appointment Jun 24–30 2026 — previously propagated to the sweep,
  // which recorded status="error" and DELETED the scheduledinjection, turning
  // a guard hiccup into a permanently lost appointment. Now any failure of the
  // guard logs loudly and PROCEEDS to inject: an extra dial is recoverable, a
  // never-dialed appointment is not.
  const gates = await getGatesConfig();
  const windowHours = gates.scheduledInjectionDedupHours;
  if (windowHours > 0) {
    const cutoffMs = Date.now() - windowHours * 3_600_000;
    let lastFiredMs = 0;
    try {
      const recent = await getFirestoreClient().list(
        injectionHistoryCollection,
        {
          where: { field: "phone", op: "==", value: phone },
          // Most-recent first. Without this, Firestore returns 5 entries in
          // document-ID order, so a phone with 6+ history docs could have its
          // latest fire fall outside the slice — the guard would then read an
          // older firedAt and permit a duplicate dial. Requires the
          // (phone asc, firedAt desc) byPhone composite index; see
          // firestore.indexes.json (DO NOT drop it).
          orderBy: { field: "firedAt", dir: "desc" },
          limit: 5,
        },
      );
      for (const r of recent) {
        const data = r.data as Record<string, unknown>;
        // Only a REAL prior dial suppresses this one. status="error" (never
        // dialed) and status="skipped" (dedup'd, also never dialed) must NOT
        // gate a real injection — otherwise one failed attempt poisons the
        // whole window and the appointment can never be recovered.
        if (data.status !== "success") continue;
        const firedAt = data.firedAt;
        if (typeof firedAt === "string") {
          const ms = new Date(firedAt).getTime();
          if (Number.isFinite(ms) && ms > lastFiredMs) lastFiredMs = ms;
        }
      }
    } catch (e) {
      // Fail OPEN — log and inject anyway. A broken dedup query (missing
      // index, Firestore blip) must not strand the appointment.
      console.error(
        `❌ [dedup-guard] query failed for ${phone}; injecting anyway ` +
          `(fail-open): ${(e as Error).message}`,
      );
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
    // ReadyMode already accepted the injection. The orchestrator writes below
    // are metadata only — wrap them in their OWN try-catch so a Firestore
    // failure (quota/network) can't propagate to the sweep's catch, which
    // would record the injectionhistory entry as status='error' even though
    // RM received the injection (and the scheduledinjection is already gone).
    // Log a warning but always return success — the inject is the source of
    // truth, not the metadata write.
    try {
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
    } catch (e) {
      console.warn(
        `[queue] ⚠️ post-inject orchestrator write failed for ${phone} (inject already succeeded, non-fatal): ${
          (e as Error).message
        }`,
      );
    }
    return { skipped: false };
  } else {
    throw new Error(`ODR injection failed: ${result.message}`);
  }
}
