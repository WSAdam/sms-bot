// Mark a phone as having answered an inbound dialer call. Accepts both:
//   POST {phone}
//   GET  ?phone=...   (or ?Phone=... — case-insensitive)
//
// The GET form mirrors the legacy URL the ReadyMode dialer fires
// (https://.../api/guests/answered?Phone=(profile.phone)) so the dialer
// config can be cut over by just swapping the host.
//
// Gate: only marks phones that exist in our system (have at least one
// injection record — pending or fired). Random callbacks for numbers we
// never scheduled don't count and return marked:false so we don't pollute
// the answered count with people we have no relationship with.

import { define } from "@/utils.ts";
import {
  guestAnsweredDocPath,
  injectionHistoryCollection,
  scheduledInjectionDocPath,
} from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

async function phoneHasInjection(phone10: string): Promise<boolean> {
  const db = getFirestoreClient();
  // Pending scheduled injection (deleted on fire) — fastest single-doc check.
  const pending = await db.get(scheduledInjectionDocPath(phone10));
  if (pending) return true;
  // Past fired injections — list one row from the prefix.
  const history = await db.list(injectionHistoryCollection, { limit: 50_000 });
  return history.some((e) => e.id.startsWith(`${phone10}__`));
}

async function markAnswered(rawPhone: unknown): Promise<Response> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) {
    return Response.json({ error: "Missing/invalid phone" }, { status: 400 });
  }
  const inOurSystem = await phoneHasInjection(phone10);
  if (!inOurSystem) {
    console.log(
      `[guests/answered] ⏭ skipped ${phone10} — no injection on file (not our lead)`,
    );
    return Response.json({
      success: true,
      phone10,
      marked: false,
      reason: "no injection on file — phone was never scheduled by our funnel",
    });
  }
  await getFirestoreClient().set(guestAnsweredDocPath(phone10), {
    phone10,
    answered: true,
    answeredAt: new Date().toISOString(),
  });
  console.log(`[guests/answered] ✅ marked ${phone10} as answered`);
  return Response.json({ success: true, phone10, marked: true });
}

function findPhoneParam(url: URL): string | null {
  for (const [k, v] of url.searchParams.entries()) {
    if (k.toLowerCase() === "phone") return v;
  }
  return null;
}

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { phone?: string; Phone?: string }
      | null;
    return markAnswered(
      body?.phone ?? body?.Phone ?? findPhoneParam(new URL(ctx.req.url)),
    );
  },
  GET(ctx) {
    return markAnswered(findPhoneParam(new URL(ctx.req.url)));
  },
});
