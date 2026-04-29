import { define } from "@/utils.ts";
import { fireSingle } from "@shared/services/injections/sweep.ts";
import { normalizePhone } from "@shared/util/phone.ts";

export const handler = define.handlers({
  async GET(ctx) {
    const url = new URL(ctx.req.url);
    const raw = url.searchParams.get("phone");
    const phone = normalizePhone(raw);
    if (!phone) return Response.json({ error: "Missing/invalid phone" }, { status: 400 });
    const r = await fireSingle(phone, "manual");
    return Response.json({ phone, ...r });
  },
});
