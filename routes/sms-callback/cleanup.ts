// Reset a guest to a clean state (testing only). Deletes context, conversations,
// pointer, rate-limit, and any scheduled injection. Best-effort scrub from ODR.

import { define } from "@/utils.ts";
import { ROOT_COLLECTION } from "@shared/config/constants.ts";
import {
  leadPointerDocPath,
  rateLimitDocPath,
  scheduledInjectionDocPath,
  smsFlowContextDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { deleteConversations } from "@shared/services/conversations/store.ts";
import { scrubLead } from "@shared/services/readymode/service.ts";
import { DialerDomain } from "@shared/types/readymode.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async DELETE(ctx) {
    const body = await ctx.req.json().catch(() => null) as { phone?: string } | null;
    if (!body?.phone) return Response.json({ error: "Missing phone" }, { status: 400 });
    const phone = normalizePhone(body.phone);
    if (!phone) return Response.json({ error: "Invalid phone" }, { status: 400 });

    const db = getFirestoreClient();

    try {
      await scrubLead(phone, DialerDomain.ODR);
    } catch (e) {
      console.warn(`[cleanup] ODR scrub failed: ${(e as Error).message}`);
    }

    const categories: Record<string, number> = {};
    let total = 0;

    for (const [name, path] of [
      ["smsflowcontext", smsFlowContextDocPath(phone)],
      ["leadpointer", leadPointerDocPath(phone)],
      ["ratelimit", rateLimitDocPath(phone)],
      ["scheduledinjection", scheduledInjectionDocPath(phone)],
    ] as const) {
      try {
        await db.delete(path);
        categories[name] = 1;
        total++;
      } catch {
        categories[name] = 0;
      }
    }

    const convoCount = await deleteConversations(phone);
    categories.conversations = convoCount;
    total += convoCount;

    // Lead history is a phone-prefixed subset of the orchestrator events collection.
    const allEvents = await db.list(`${ROOT_COLLECTION}/orchestratorevents/byPhone`, {
      limit: 500,
    });
    const events = allEvents.filter((e) => e.id.startsWith(`${phone}__`));
    await db.batch(
      events.map((e) => ({
        type: "delete" as const,
        path: `${ROOT_COLLECTION}/orchestratorevents/byPhone/${e.id}`,
      })),
    );
    categories.lead_history = events.length;
    total += events.length;

    return Response.json({ status: "success", phone, deleted: total, categories });
  },
});
