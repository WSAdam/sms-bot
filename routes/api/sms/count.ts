// Today's SMS count (token-gated). Body: { test: SMS_COUNT_TOKEN, [date] }.

import { define } from "@/utils.ts";
import { loadEnv } from "@shared/config/env.ts";
import { getCount } from "@shared/services/sms-count/service.ts";
import { easternDateString } from "@shared/util/time.ts";

export const handler = define.handlers({
  async POST(ctx) {
    const env = loadEnv();
    const body = await ctx.req.json().catch(() => null) as
      | { test?: string; date?: string }
      | null;

    if (env.smsCountToken && body?.test !== env.smsCountToken) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
    const date = body?.date ?? easternDateString();
    const count = await getCount(date);
    return Response.json({ date, count });
  },
});
