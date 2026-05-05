// Live-editable cron config endpoint. Powers the "Cron Config" card on
// the test page so Adam can change recipients / subject / reportId /
// enabled flags without a code deploy.
//
// GET   → current config
// POST  → merge body into current config and save

import { define } from "@/utils.ts";
import {
  type CronConfig,
  getCronConfig,
  setCronConfig,
} from "@shared/services/config/cron-config.ts";

export const handler = define.handlers({
  async GET() {
    const config = await getCronConfig();
    return Response.json(config);
  },
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | Partial<Pick<CronConfig, "report" | "qbSaleMatch">>
      | null;
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const updated = await setCronConfig(body);
    return Response.json(updated);
  },
});
