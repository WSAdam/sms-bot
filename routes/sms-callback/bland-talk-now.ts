// Hot-path immediate injection. Optional source-domain scrub (best-effort,
// no lock — gotcha §15), then inject into the ODR Appointments campaign.
// After a successful inject, write an injectionhistory doc with
// firedBy:"talk-now" so sale-match can credit later activations and the
// dashboard can render the actual call moment as the scheduled time.
// Without that audit trail, talk-now sales used to surface only via the
// answered-backfill script reconstructing them after the fact.

import { define } from "@/utils.ts";
import {
  injectionHistoryDocPath,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { ingestBlandTranscript } from "@shared/services/conversations/reseed.ts";
import {
  CAMPAIGN_MASTER_MAP,
  getCampaignConfig,
} from "@shared/services/readymode/campaigns.ts";
import { denormalize } from "@shared/services/readymode/mapping.ts";
import { injectLead, scrubLead } from "@shared/services/readymode/service.ts";
import { getContext } from "@shared/services/sms-flow-context/service.ts";
import {
  type DialerDomain,
  type ReadymodeLeadDto,
  type StandardLead,
} from "@shared/types/readymode.ts";
import {
  injectionDiscriminator,
  injectionHistoryDocId,
} from "@shared/util/id.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; phoneNumber?: string }
      | null;
    const phoneInput = body?.phoneNumber ?? body?.phone;
    if (!phoneInput) {
      return Response.json({ error: "Phone required" }, { status: 400 });
    }
    const phone = normalizePhone(phoneInput);
    if (!phone) {
      return Response.json({ error: "Invalid phone" }, { status: 400 });
    }

    const context = (await getContext(phone)) ?? {};
    if ((context as { domain?: string }).domain) {
      try {
        await scrubLead(
          phone,
          (context as { domain: string }).domain as DialerDomain,
        );
      } catch (e) {
        console.warn(
          `[talk-now] scrub failed (optional): ${(e as Error).message}`,
        );
      }
    }

    const target = getCampaignConfig("ODR - Appointments") ??
      CAMPAIGN_MASTER_MAP["ODR - Appointments"];
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
    // Discriminate the doc id with a per-request nonce. Two concurrent talk-now
    // injections for the SAME phone can produce the SAME firedAt ISO millisecond;
    // without a discriminator their doc ids collide and set(merge:false) silently
    // overwrites the first, losing one injection's audit trail. (conversationDocId
    // got the same treatment — this is the injectionhistory twin.)
    const firedDiscriminator = injectionDiscriminator();
    try {
      await getFirestoreClient().set(
        injectionHistoryDocPath(
          injectionHistoryDocId(phone, firedAt, firedDiscriminator),
        ),
        {
          phone,
          eventTime: firedAt,
          scheduledAt: new Date(firedAt).getTime(),
          firedAt,
          firedBy: "talk-now",
          // Record the ACTUAL inject verdict, not a hardcoded "success".
          // injectLead returns {status:"error"} without throwing (e.g.
          // duplicate lead / RM rejection); writing "success" regardless
          // logged phantom injects into the audit trail.
          status: result.status === "success" ? "success" : "error",
          // Explicitly NOT eventTimePlaceholder. The appointment really
          // is "now" — the guest just consented to be called immediately.
          campaignId: target.id,
          campaignName: target.name,
        },
      );
    } catch (e) {
      console.warn(
        `[talk-now] ih write failed (non-fatal): ${(e as Error).message}`,
      );
    }

    // Clean up the companion scheduledinjection doc so the sweep doesn't
    // re-fire later — but ONLY when the inject actually succeeded. The
    // 2026-05-25 near-miss was caused by this exact race: talk-now wrote an
    // injectionhistory entry but left the pending doc in place, and when the
    // sweep came back online it dialed the same customer again. If the inject
    // FAILED, deleting the pending marker would orphan the lead (no inject, no
    // pending doc) — leave it so the sweep can retry. Idempotent — db.delete on
    // a missing doc is a no-op. Best-effort: failure here doesn't block.
    if (result.status === "success") {
      try {
        await getFirestoreClient().delete(scheduledInjectionDocPath(phone));
      } catch (e) {
        console.warn(
          `[talk-now] scheduledinjection delete failed (non-fatal): ${
            (e as Error).message
          }`,
        );
      }
    }

    // Now that the inject succeeded, pull the full Bland transcript into
    // `conversations` so the review view isn't empty for talk-now leads (the
    // talk-now exchange lives in Bland — we only got the signal). Additive +
    // best-effort: never blocks the response. No conversationId in the
    // talk-now payload, so resolve by phone. See context.md §0.21.
    if (result.status === "success") {
      try {
        await ingestBlandTranscript(phone);
      } catch (e) {
        console.warn(
          `[talk-now] transcript ingest failed (non-fatal): ${
            (e as Error).message
          }`,
        );
      }
    }

    // Reflect the real inject verdict in the response too — a failed inject
    // must not report 200/"success".
    if (result.status !== "success") {
      return Response.json(
        {
          status: "error",
          message: `Inject to ${target.name} failed`,
          result,
        },
        { status: 502 },
      );
    }

    return Response.json({
      status: "success",
      message: `Injected to ${target.name}`,
      result,
    });
  },
});
