// Mark a phone as having answered an inbound dialer call. Accepts both:
//   POST {phone}
//   GET  ?phone=...   (or ?Phone=... — case-insensitive)
//
// The GET form mirrors the legacy URL the ReadyMode dialer fires
// (https://.../api/guests/answered?Phone=(profile.phone)) so the dialer
// config can be cut over by just swapping the host.

import { define } from "@/utils.ts";
import { guestAnsweredDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

async function markAnswered(rawPhone: unknown): Promise<Response> {
  const phone10 = normalizePhone(rawPhone);
  if (!phone10) {
    return Response.json({ error: "Missing/invalid phone" }, { status: 400 });
  }
  await getFirestoreClient().set(guestAnsweredDocPath(phone10), {
    phone10,
    answered: true,
    answeredAt: new Date().toISOString(),
  });
  console.log(`[guests/answered] ✅ marked ${phone10} as answered`);
  return Response.json({ success: true, phone10 });
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
