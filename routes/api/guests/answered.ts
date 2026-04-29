import { define } from "@/utils.ts";
import { guestAnsweredDocPath } from "@shared/firestore/paths.ts";
import { getFirestoreClient } from "@shared/firestore/wrapper.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as { phone?: string } | null;
    const phone10 = normalizePhone(body?.phone);
    if (!phone10) return Response.json({ error: "Missing/invalid phone" }, { status: 400 });
    await getFirestoreClient().set(guestAnsweredDocPath(phone10), {
      phone10,
      answered: true,
      answeredAt: new Date().toISOString(),
    });
    return Response.json({ success: true, phone10 });
  },
});
