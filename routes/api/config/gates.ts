// Live-editable gates config endpoint. Powers the "Gates" card on the
// test page + the explainer panel at the top of the dashboard. Adam can
// change the attempts threshold, sale-match window, global daily SMS cap,
// and per-phone rate-limit window from the dashboard without redeploying.
//
// GET  → current merged config (Firestore doc overrides shipped defaults)
// POST → merge body into current and save

import { define } from "@/utils.ts";
import {
  type GatesConfig,
  getGatesConfig,
  setGatesConfig,
} from "@shared/services/config/gates-config.ts";

export const handler = define.handlers({
  async GET() {
    const config = await getGatesConfig();
    return Response.json(config);
  },
  async POST(ctx) {
    const body = await ctx.req.json().catch(() => null) as
      | Partial<
        Pick<
          GatesConfig,
          | "attemptsThreshold"
          | "saleMatchWindowDays"
          | "globalDailySmsCap"
          | "rateLimitWindowDays"
          | "costPerText"
          | "earningsPerSale"
          | "tpiMinSpacingMs"
          | "tpiMaxPer5Min"
          | "scheduledInjectionSweepEnabled"
          | "scheduledInjectionDedupHours"
          | "inboundWindowStartEt"
          | "inboundWindowEndEt"
        >
      >
      | null;
    if (!body) {
      return Response.json({ error: "Invalid JSON body" }, { status: 400 });
    }
    const updated = await setGatesConfig(body);
    return Response.json(updated);
  },
});
