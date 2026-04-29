// Bulk SHA-256 phone activation. Body: { hashes: ["sha256_hex", ...] }.
// For each hash, look it up against scheduled-injection phones (last 7 days)
// by hashing each candidate phone10 and comparing. If a match exists, write
// guestactivated/byPhone/{phone10}.

import { define } from "@/utils.ts";
import { SALE_MATCH_WINDOW_DAYS } from "@shared/config/constants.ts";
import {
  guestActivatedDocPath,
  scheduledInjectionsCollection,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import type { FutureInjection } from "@shared/types/injection.ts";
import { sha256Hex } from "@shared/util/id.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { hashes?: string[] }
      | null;
    if (!Array.isArray(body?.hashes)) {
      return Response.json({ error: "Body must be {hashes: [hex,...]}" }, { status: 400 });
    }
    const incoming = new Set(body!.hashes.map((h) => h.toLowerCase()));
    const db = getFirestoreClient();

    const cutoffMs = Date.now() - SALE_MATCH_WINDOW_DAYS * 24 * 60 * 60 * 1000;
    const all = await db.list(scheduledInjectionsCollection, { limit: 5000 });

    const activatedAt = new Date().toISOString();
    const matched: string[] = [];

    for (const e of all) {
      const inj = e.data as unknown as FutureInjection;
      if (new Date(inj.eventTime).getTime() < cutoffMs) continue;
      const hash = await sha256Hex(e.id);
      if (!incoming.has(hash)) continue;
      await db.set(guestActivatedDocPath(e.id), {
        phone10: e.id,
        Activated: true,
        activatedAt,
        eventTime: inj.eventTime,
      });
      matched.push(e.id);
    }

    return Response.json({
      success: true,
      received: incoming.size,
      matched: matched.length,
      phones: matched,
    });
  },
});
