// Today's SMS count (no auth — read-only on a non-sensitive aggregate).

import { define } from "@/utils.ts";
import { getCount } from "@shared/services/sms-count/service.ts";
import { easternDateString } from "@shared/util/time.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | { date?: string }
      | null;
    const date = body?.date ?? easternDateString();
    const count = await getCount(date);
    return Response.json({ date, count });
  },
});
